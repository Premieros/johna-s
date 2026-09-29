import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, ChevronDown, ChevronUp, Plus, Save, Search, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import * as api from '@/api';
import { APP_ROUTES } from '@/core/navigation/routes';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useCan } from '@/lib/permissions';
import type { Category, InventoryUnit, Product } from '@/lib/types';

type InventoryEffect = {
  target_type: 'raw_material' | 'inventory_unit';
  target_id: string;
  quantity_delta: number;
};

type ModifierOptionRow = {
  id?: string;
  source_unit_id?: string;
  name: string;
  name_en: string;
  price_delta: number;
  is_default: boolean;
  sort_order: number;
  inventory_effects: InventoryEffect[];
};

type ModifierGroupRow = {
  id?: string;
  name: string;
  name_en: string;
  min_selections: number;
  max_selections: number;
  sort_order: number;
  product_ids: string[];
  options: ModifierOptionRow[];
};

type AdminGroup = {
  id?: string;
  name?: string;
  name_en?: string | null;
  min_selections?: number;
  max_selections?: number;
  sort_order?: number;
  product_ids?: string[];
  options?: Array<{
    id?: string;
    name?: string;
    name_en?: string | null;
    price_delta?: number;
    is_default?: boolean;
    sort_order?: number;
    inventory_effects?: InventoryEffect[];
  }>;
};

type AdminGroupsResponse = {
  success?: boolean;
  error?: string;
  detail?: string;
  groups?: AdminGroup[];
};

const newGroup = (): ModifierGroupRow => ({
  name: '',
  name_en: '',
  min_selections: 0,
  max_selections: 1,
  sort_order: 0,
  product_ids: [],
  options: [],
});

const normalize = (groups: AdminGroup[]): ModifierGroupRow[] => groups.map((group) => ({
  id: group.id,
  name: group.name || '',
  name_en: group.name_en || '',
  min_selections: Number(group.min_selections || 0),
  max_selections: Math.max(1, Number(group.max_selections || 1)),
  sort_order: Number(group.sort_order || 0),
  product_ids: Array.isArray(group.product_ids) ? group.product_ids : [],
  options: (group.options || []).map((option, optionIndex) => {
    const effects = Array.isArray(option.inventory_effects) ? option.inventory_effects : [];
    const source = effects.length === 1
      && effects[0].target_type === 'inventory_unit'
      && Number(effects[0].quantity_delta) === 1
      ? effects[0].target_id
      : undefined;
    return {
      id: option.id,
      source_unit_id: source,
      name: option.name || '',
      name_en: option.name_en || '',
      price_delta: Number(option.price_delta || 0),
      is_default: Boolean(option.is_default),
      sort_order: Number(option.sort_order ?? optionIndex),
      inventory_effects: effects,
    };
  }),
}));

export function ProductModifiersPage() {
  const { lang } = useLanguage();
  const isAr = lang === 'ar';
  const { show } = useToast();
  const can = useCan();
  const canManage = can('products.modifiers.manage');
  const branchFilter = useBranchFilter();

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [componentGroups, setComponentGroups] = useState<InventoryUnit[]>([]);
  const [groups, setGroups] = useState<ModifierGroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [selectedOnly, setSelectedOnly] = useState(false);

  const load = useCallback(async () => {
    if (!branchFilter) {
      setProducts([]);
      setCategories([]);
      setComponentGroups([]);
      setGroups([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [selectors, groupsResult, units] = await Promise.all([
        loadProductModifierSelectors(branchFilter),
        api.catalog.listModifierGroupsAdmin(branchFilter),
        api.catalog.listInventoryUnits({ branch_id: branchFilter, unit_type: 'manufactured', is_active: true }),
      ]);

      if (groupsResult.error) throw groupsResult.error;

      const result = (groupsResult.data || {}) as AdminGroupsResponse;
      if (!result.success) throw new Error(result.detail || result.error || 'LOAD_MODIFIER_GROUPS_FAILED');

      setProducts(selectors.products);
      setCategories(selectors.categories);
      setComponentGroups((units || []) as InventoryUnit[]);
      setGroups(normalize(result.groups || []));
    } catch (err) {
      show(err instanceof Error ? err.message : 'Failed to load modifier groups', 'error');
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, [branchFilter, show]);

  useEffect(() => { void load(); }, [load]);

  const updateGroup = (groupIndex: number, patch: Partial<ModifierGroupRow>) => {
    setGroups((prev) => prev.map((group, index) => index === groupIndex ? { ...group, ...patch } : group));
  };

  const updateOption = (groupIndex: number, optionIndex: number, patch: Partial<ModifierOptionRow>) => {
    setGroups((prev) => prev.map((group, index) => {
      if (index !== groupIndex) return group;
      return { ...group, options: group.options.map((option, i) => i === optionIndex ? { ...option, ...patch } : option) };
    }));
  };

  const chooseSource = (groupIndex: number, optionIndex: number, unitId: string) => {
    const unit = componentGroups.find((candidate) => candidate.id === unitId);
    if (!unit) return;
    updateOption(groupIndex, optionIndex, {
      source_unit_id: unit.id,
      name: unit.name,
      name_en: unit.name_en || '',
      inventory_effects: [{ target_type: 'inventory_unit', target_id: unit.id, quantity_delta: 1 }],
    });
  };

  const addOption = (groupIndex: number) => {
    const group = groups[groupIndex];
    updateGroup(groupIndex, {
      options: [...group.options, {
        name: '',
        name_en: '',
        price_delta: 0,
        is_default: false,
        sort_order: group.options.length,
        inventory_effects: [],
      }],
    });
  };

  const removeOption = (groupIndex: number, optionIndex: number) => {
    const group = groups[groupIndex];
    updateGroup(groupIndex, { options: group.options.filter((_, index) => index !== optionIndex) });
  };

  const toggleProduct = (groupIndex: number, productId: string) => {
    const group = groups[groupIndex];
    const next = group.product_ids.includes(productId)
      ? group.product_ids.filter((id) => id !== productId)
      : [...group.product_ids, productId];
    updateGroup(groupIndex, { product_ids: next });
  };

  const visibleProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    return products.filter((product) => {
      if (categoryFilter && product.category_id !== categoryFilter) return false;
      if (q && !`${product.name} ${product.name_en || ''} ${product.sku || ''} ${product.barcode || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [products, productSearch, categoryFilter]);

  const friendlyModifierError = (error?: string, detail?: string) => {
    if (error === 'MODIFIER_GROUP_HAS_OPEN_ORDERS') {
      return isAr
        ? 'لا يمكن تعديل أو إيقاف هذه المجموعة الآن لأن أحد منتجاتها موجود في طلب مفتوح.'
        : 'This group cannot be edited or archived while one of its products is in an open order.';
    }
    if (error === 'REQUIRED_MODIFIER_HAS_OPEN_ORDERS') {
      return isAr
        ? 'لا يمكن جعل هذه المجموعة مطلوبة الآن لأن أحد المنتجات المرتبطة بها موجود في طلب مفتوح.'
        : 'This group cannot be made required while an assigned product is in an open order.';
    }
    return detail || error || (isAr ? 'تعذر حفظ مجموعة الإضافات.' : 'Could not save modifier group.');
  };

  const saveGroup = async (groupIndex: number) => {
    if (!branchFilter || !canManage) return;
    const group = groups[groupIndex];
    if (!group.name.trim()) {
      show(isAr ? 'اسم المجموعة مطلوب' : 'Group name is required', 'error');
      return;
    }
    if (group.product_ids.length === 0) {
      show(isAr ? 'اربط المجموعة بمنتج واحد على الأقل' : 'Assign at least one product', 'error');
      return;
    }
    if (group.options.length === 0) {
      show(isAr ? 'أضف اختيارًا واحدًا على الأقل' : 'Add at least one option', 'error');
      return;
    }
    if (group.min_selections < 0 || group.max_selections < 1 || group.min_selections > group.max_selections) {
      show(isAr ? 'تحقق من الحد الأدنى والأقصى للاختيارات' : 'Check min/max selections', 'error');
      return;
    }
    if (group.max_selections > group.options.length) {
      show(isAr ? 'الحد الأقصى لا يمكن أن يتجاوز عدد الاختيارات' : 'Maximum cannot exceed option count', 'error');
      return;
    }
    for (const option of group.options) {
      if (!option.name.trim()) {
        show(isAr ? 'كل اختيار يجب أن يكون له اسم' : 'Every option needs a name', 'error');
        return;
      }
      if (option.inventory_effects.length === 0) {
        show(isAr ? `اربط الاختيار "${option.name}" بمجموعة مكونات` : `Link "${option.name}" to a component group`, 'error');
        return;
      }
    }

    const saveKey = group.id || `new-${groupIndex}`;
    setSavingId(saveKey);
    try {
      const payload = {
        name: group.name.trim(),
        name_en: group.name_en.trim() || null,
        min_selections: group.min_selections,
        max_selections: group.max_selections,
        sort_order: group.sort_order,
        options: group.options.map((option, optionIndex) => ({
          id: option.id || undefined,
          name: option.name.trim(),
          name_en: option.name_en.trim() || null,
          price_delta: Number(option.price_delta || 0),
          is_default: option.is_default,
          sort_order: optionIndex,
          inventory_effects: option.inventory_effects,
        })),
      };

      const { data, error } = await api.catalog.saveModifierGroup({
        p_group_id: group.id || null,
        p_branch_id: branchFilter,
        p_group: payload,
        p_product_ids: group.product_ids,
      });
      if (error) throw error;

      const result = (data || {}) as { success?: boolean; error?: string; detail?: string; group_id?: string };
      if (!result.success) throw new Error(friendlyModifierError(result.error, result.detail));

      show(isAr ? 'تم حفظ المجموعة والمنتجات والاختيارات' : 'Group, products and options saved', 'success');
      await load();
      setExpandedId(result.group_id || group.id || null);
    } catch (err) {
      show(err instanceof Error ? err.message : 'Failed to save modifier group', 'error');
    } finally {
      setSavingId(null);
    }
  };

  const archiveGroup = async (group: ModifierGroupRow) => {
    if (!group.id || !canManage) return;
    setArchivingId(group.id);
    try {
      const { data, error } = await api.catalog.archiveModifierGroup(group.id);
      if (error) throw error;
      const result = (data || {}) as { success?: boolean; error?: string; detail?: string };
      if (!result.success) throw new Error(friendlyModifierError(result.error, result.detail));
      show(isAr ? 'تم إيقاف المجموعة' : 'Group archived', 'success');
      await load();
    } catch (err) {
      show(err instanceof Error ? err.message : 'Failed to archive group', 'error');
    } finally {
      setArchivingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-black text-ui-text">{isAr ? 'مجموعات الإضافات' : 'Modifier Groups'}</h1>
          <p className="mt-1 text-sm text-ui-muted">
            {isAr ? 'المجموعة تجمع الاختيارات وتحدد الحد الأدنى والأقصى وتُربط بالمنتجات مرة واحدة.' : 'A group collects options, min/max rules, and product assignments.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={APP_ROUTES.productModifierOptions} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-ui-border bg-ui-surface px-4 font-bold text-ui-text">
            {isAr ? 'الخيارات' : 'Options'}
          </Link>
          {canManage && branchFilter && (
            <button
              type="button"
              onClick={() => {
                setGroups((prev) => [...prev, newGroup()]);
                setExpandedId(`new-${groups.length}`);
              }}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-ui-primary px-4 py-2 font-bold text-ui-primary-fg"
            >
              <Plus className="h-4 w-4" /> {isAr ? 'مجموعة جديدة' : 'New group'}
            </button>
          )}
        </div>
      </div>

      {!branchFilter ? (
        <div className="rounded-2xl border border-ui-border bg-ui-surface p-6 text-center text-ui-muted">{isAr ? 'اختر الفرع أولًا.' : 'Select the active branch first.'}</div>
      ) : !canManage ? (
        <div className="rounded-2xl border border-ui-border bg-ui-surface p-6 text-center text-ui-muted">{isAr ? 'ليس لديك صلاحية إدارة الموديفاير.' : 'You do not have permission to manage modifiers.'}</div>
      ) : loading ? (
        <div className="py-16 text-center text-ui-muted">{isAr ? 'جاري التحميل…' : 'Loading…'}</div>
      ) : (
        <div className="space-y-2">
          {groups.length === 0 && <div className="rounded-2xl border border-dashed border-ui-border bg-ui-surface p-10 text-center text-ui-muted">{isAr ? 'لا توجد مجموعات إضافات بعد.' : 'No modifier groups yet.'}</div>}
          {groups.map((group, groupIndex) => {
            const rowKey = group.id || `new-${groupIndex}`;
            const expanded = expandedId === rowKey;
            const filteredForGroup = visibleProducts.filter((product) => !selectedOnly || group.product_ids.includes(product.id));
            return (
              <section key={rowKey} className="overflow-hidden rounded-2xl border border-ui-border bg-ui-surface">
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : rowKey)}
                  className="grid w-full grid-cols-[1fr_auto] items-center gap-3 p-4 text-start md:grid-cols-[2fr_110px_110px_90px_90px_auto]"
                >
                  <div className="min-w-0">
                    <p className="truncate font-black text-ui-text">{group.name || (isAr ? 'مجموعة جديدة' : 'New group')}</p>
                    <p className="mt-0.5 text-xs text-ui-muted md:hidden">{group.options.length} {isAr ? 'اختيارات' : 'options'} · {group.product_ids.length} {isAr ? 'منتج' : 'products'} · {group.min_selections}-{group.max_selections}</p>
                  </div>
                  <span className="hidden text-center text-sm text-ui-muted md:block">{group.options.length}</span>
                  <span className="hidden text-center text-sm text-ui-muted md:block">{group.product_ids.length}</span>
                  <span className="hidden text-center text-sm text-ui-muted md:block">Min {group.min_selections}</span>
                  <span className="hidden text-center text-sm text-ui-muted md:block">Max {group.max_selections}</span>
                  <span className="text-ui-muted">{expanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}</span>
                </button>

                {expanded && (
                  <div className="space-y-5 border-t border-ui-border p-4">
                    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-[1.2fr_1.2fr_120px_120px]">
                      <label className="text-sm font-semibold text-ui-text">{isAr ? 'اسم المجموعة للإدارة' : 'Internal group name'}<input value={group.name} onChange={(e) => updateGroup(groupIndex, { name: e.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-ui-border bg-ui-page px-3" /></label>
                      <label className="text-sm font-semibold text-ui-text">English<input value={group.name_en} onChange={(e) => updateGroup(groupIndex, { name_en: e.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-ui-border bg-ui-page px-3" /></label>
                      <label className="text-sm font-semibold text-ui-text">{isAr ? 'الحد الأدنى' : 'Minimum'}<input type="number" min={0} value={group.min_selections} onChange={(e) => updateGroup(groupIndex, { min_selections: Math.max(0, Number(e.target.value) || 0) })} className="mt-1 min-h-11 w-full rounded-xl border border-ui-border bg-ui-page px-3" /></label>
                      <label className="text-sm font-semibold text-ui-text">{isAr ? 'الحد الأقصى' : 'Maximum'}<input type="number" min={1} value={group.max_selections} onChange={(e) => updateGroup(groupIndex, { max_selections: Math.max(1, Number(e.target.value) || 1) })} className="mt-1 min-h-11 w-full rounded-xl border border-ui-border bg-ui-page px-3" /></label>
                    </div>

                    <div className="rounded-xl border border-ui-border bg-ui-page-alt p-3">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-black text-ui-text">{isAr ? 'الاختيارات' : 'Options'}</p>
                          <p className="text-xs text-ui-muted">{isAr ? 'اختر مجموعة مكونات؛ الاسم يُستخدم تلقائيًا في نقطة البيع.' : 'Choose a component group; its name is used automatically in POS.'}</p>
                        </div>
                        <button type="button" onClick={() => addOption(groupIndex)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-ui-border bg-ui-surface px-3 text-sm font-bold"><Plus className="h-4 w-4" />{isAr ? 'إضافة اختيار' : 'Add option'}</button>
                      </div>
                      <div className="space-y-2">
                        {group.options.map((option, optionIndex) => (
                          <div key={option.id || `option-${optionIndex}`} className="grid gap-2 rounded-xl border border-ui-border bg-ui-surface p-2 md:grid-cols-[1fr_150px_auto]">
                            <select
                              value={option.source_unit_id || ''}
                              onChange={(e) => chooseSource(groupIndex, optionIndex, e.target.value)}
                              className="min-h-11 rounded-xl border border-ui-border bg-ui-page px-3"
                            >
                              <option value="">{option.name ? `${option.name} — ${isAr ? 'خيار قديم/مخصص' : 'legacy/custom'}` : (isAr ? 'اختر المكوّن' : 'Choose component')}</option>
                              {componentGroups.map((unit) => <option key={unit.id} value={unit.id}>{isAr ? unit.name : unit.name_en || unit.name}</option>)}
                            </select>
                            <label className="flex items-center gap-2 rounded-xl border border-ui-border bg-ui-page px-3">
                              <span className="text-xs font-bold text-ui-muted">{isAr ? 'فرق السعر' : 'Price'}</span>
                              <input type="number" step="0.01" value={option.price_delta} onChange={(e) => updateOption(groupIndex, optionIndex, { price_delta: Number(e.target.value) || 0 })} className="min-h-9 min-w-0 flex-1 bg-transparent text-end outline-none" />
                            </label>
                            <button type="button" onClick={() => removeOption(groupIndex, optionIndex)} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-ui-danger/40 px-3 text-ui-danger"><Trash2 className="h-4 w-4" /></button>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-xl border border-ui-border bg-ui-page-alt p-3">
                      <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
                        <div>
                          <p className="text-sm font-black text-ui-text">{isAr ? 'المنتجات المرتبطة' : 'Assigned products'}</p>
                          <p className="text-xs text-ui-muted">{group.product_ids.length} {isAr ? 'منتج مرتبط' : 'products assigned'}</p>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[240px_180px_auto_auto]">
                          <div className="relative"><Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ui-subtle" /><input value={productSearch} onChange={(e) => setProductSearch(e.target.value)} placeholder={isAr ? 'بحث بالاسم أو الكود' : 'Search name/code'} className="min-h-10 w-full rounded-xl border border-ui-border bg-ui-surface ps-9 pe-3 text-sm" /></div>
                          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="min-h-10 rounded-xl border border-ui-border bg-ui-surface px-3 text-sm"><option value="">{isAr ? 'كل التصنيفات' : 'All categories'}</option>{categories.map((category) => <option key={category.id} value={category.id}>{isAr ? category.name : category.name_en || category.name}</option>)}</select>
                          <button type="button" onClick={() => updateGroup(groupIndex, { product_ids: Array.from(new Set([...group.product_ids, ...visibleProducts.map((product) => product.id)])) })} className="min-h-10 rounded-xl border border-ui-border bg-ui-surface px-3 text-xs font-bold">{isAr ? 'تحديد نتائج البحث' : 'Select results'}</button>
                          <button type="button" onClick={() => setSelectedOnly((value) => !value)} className="min-h-10 rounded-xl border border-ui-border bg-ui-surface px-3 text-xs font-bold">{selectedOnly ? (isAr ? 'عرض الكل' : 'Show all') : (isAr ? 'المختار فقط' : 'Selected only')}</button>
                        </div>
                      </div>
                      <div className="grid max-h-72 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {filteredForGroup.map((product) => {
                          const checked = group.product_ids.includes(product.id);
                          return <label key={product.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-ui-border bg-ui-surface px-3 py-2 text-sm text-ui-text"><input type="checkbox" checked={checked} onChange={() => toggleProduct(groupIndex, product.id)} className="h-4 w-4" /><span className="min-w-0 truncate">{isAr ? product.name : product.name_en || product.name}</span></label>;
                        })}
                      </div>
                    </div>

                    <div className="flex flex-wrap justify-end gap-2">
                      {group.id && <button type="button" onClick={() => void archiveGroup(group)} disabled={archivingId === group.id} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-ui-danger/40 px-4 font-bold text-ui-danger disabled:opacity-50"><Archive className="h-4 w-4" />{isAr ? 'إيقاف المجموعة' : 'Archive'}</button>}
                      <button type="button" onClick={() => void saveGroup(groupIndex)} disabled={savingId === rowKey} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-ui-primary px-5 font-bold text-ui-primary-fg disabled:opacity-50"><Save className="h-4 w-4" />{isAr ? 'حفظ المجموعة' : 'Save group'}</button>
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
