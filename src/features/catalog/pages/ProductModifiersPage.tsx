import { useCallback, useEffect, useState } from 'react';
import { Archive, ChevronDown, Plus, Save, Trash2 } from 'lucide-react';
import { supabase } from '@/api';
import * as api from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { formatNumber } from '@/lib/format';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useCan } from '@/lib/permissions';
import type { InventoryUnit, Product } from '@/lib/types';

interface RawMaterialRef {
  id: string;
  name: string;
  branch_id: string | null;
}

type EffectTarget = 'raw_material' | 'inventory_unit';

interface ModifierEffectDraft {
  target_type: EffectTarget;
  target_id: string;
  quantity_delta: number;
}

interface ModifierOptionDraft {
  id?: string;
  name: string;
  name_en: string;
  price_delta: number;
  is_default: boolean;
  sort_order: number;
  inventory_effects: ModifierEffectDraft[];
}

interface ModifierGroupDraft {
  id?: string;
  name: string;
  name_en: string;
  min_selections: number;
  max_selections: number;
  sort_order: number;
  product_ids: string[];
  options: ModifierOptionDraft[];
}

type AdminGroupsResponse = {
  success?: boolean;
  error?: string;
  detail?: string;
  groups?: ModifierGroupDraft[];
};

const emptyGroup = (sort: number): ModifierGroupDraft => ({
  name: '',
  name_en: '',
  min_selections: 0,
  max_selections: 1,
  sort_order: sort,
  product_ids: [],
  options: [],
});

const emptyOption = (sort: number): ModifierOptionDraft => ({
  name: '',
  name_en: '',
  price_delta: 0,
  is_default: false,
  sort_order: sort,
  inventory_effects: [],
});

const normalizeGroups = (groups: ModifierGroupDraft[]): ModifierGroupDraft[] => groups.map((group, gi) => ({
  ...group,
  name_en: group.name_en || '',
  sort_order: Number(group.sort_order ?? gi),
  min_selections: Number(group.min_selections || 0),
  max_selections: Number(group.max_selections || 1),
  product_ids: Array.isArray(group.product_ids) ? group.product_ids : [],
  options: (group.options || []).map((option, oi) => ({
    ...option,
    name_en: option.name_en || '',
    price_delta: Number(option.price_delta || 0),
    sort_order: Number(option.sort_order ?? oi),
    is_default: !!option.is_default,
    inventory_effects: (option.inventory_effects || []).map((effect) => ({
      target_type: effect.target_type,
      target_id: effect.target_id,
      quantity_delta: Number(effect.quantity_delta || 0),
    })),
  })),
}));

export function ProductModifiersPage() {
  const { lang } = useLanguage();
  const isAr = lang === 'ar';
  const { show } = useToast();
  const can = useCan();
  const canManage = can('products.modifiers.manage');
  const branchFilter = useBranchFilter();
  const [products, setProducts] = useState<Product[]>([]);
  const [groups, setGroups] = useState<ModifierGroupDraft[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawMaterialRef[]>([]);
  const [inventoryUnits, setInventoryUnits] = useState<InventoryUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingIndex, setSavingIndex] = useState<number | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!branchFilter) {
      setProducts([]);
      setGroups([]);
      setRawMaterials([]);
      setInventoryUnits([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [productResult, groupsResult, rawResult, units] = await Promise.all([
        supabase.from('products').select('*').eq('branch_id', branchFilter).eq('is_active', true).order('name'),
        api.catalog.listModifierGroupsAdmin(branchFilter),
        supabase.from('raw_materials').select('id,name,branch_id').eq('branch_id', branchFilter).eq('is_active', true).order('name'),
        api.catalog.listInventoryUnits({ branch_id: branchFilter, is_active: true }),
      ]);

      if (productResult.error) throw productResult.error;
      if (rawResult.error) throw rawResult.error;
      if (groupsResult.error) throw groupsResult.error;

      const result = (groupsResult.data || {}) as AdminGroupsResponse;
      if (!result.success) throw new Error(result.detail || result.error || 'LOAD_MODIFIER_GROUPS_FAILED');

      setProducts((productResult.data || []) as Product[]);
      setGroups(normalizeGroups(result.groups || []));
      setRawMaterials((rawResult.data || []) as RawMaterialRef[]);
      setInventoryUnits((units || []) as InventoryUnit[]);
    } catch (err) {
      show(err instanceof Error ? err.message : 'Failed to load modifier groups', 'error');
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, [branchFilter, show]);

  useEffect(() => { void load(); }, [load]);

  const updateGroup = (groupIndex: number, patch: Partial<ModifierGroupDraft>) => {
    setGroups((prev) => prev.map((group, index) => index === groupIndex ? { ...group, ...patch } : group));
  };

  const updateOption = (groupIndex: number, optionIndex: number, patch: Partial<ModifierOptionDraft>) => {
    setGroups((prev) => prev.map((group, gi) => gi === groupIndex
      ? { ...group, options: group.options.map((option, oi) => oi === optionIndex ? { ...option, ...patch } : option) }
      : group));
  };

  const updateEffect = (groupIndex: number, optionIndex: number, effectIndex: number, patch: Partial<ModifierEffectDraft>) => {
    setGroups((prev) => prev.map((group, gi) => gi === groupIndex
      ? {
          ...group,
          options: group.options.map((option, oi) => oi === optionIndex
            ? { ...option, inventory_effects: option.inventory_effects.map((effect, ei) => ei === effectIndex ? { ...effect, ...patch } : effect) }
            : option),
        }
      : group));
  };

  const toggleProduct = (groupIndex: number, productId: string) => {
    const group = groups[groupIndex];
    const productIds = group.product_ids.includes(productId)
      ? group.product_ids.filter((id) => id !== productId)
      : [...group.product_ids, productId];
    updateGroup(groupIndex, { product_ids: productIds });
  };

  const validateGroup = (group: ModifierGroupDraft) => {
    if (!group.name.trim()) return isAr ? 'اسم مجموعة الموديفاير مطلوب' : 'Modifier group name is required';
    if (group.min_selections < 0 || group.max_selections < 1 || group.max_selections < group.min_selections || group.max_selections > Math.max(group.options.length, 1)) {
      return isAr ? `حدود الاختيار غير صالحة: ${group.name}` : `Invalid selection limits: ${group.name}`;
    }
    for (const option of group.options) {
      if (!option.name.trim()) return isAr ? 'اسم الاختيار مطلوب' : 'Modifier option name is required';
      for (const effect of option.inventory_effects) {
        if (!effect.target_id || !Number.isFinite(effect.quantity_delta) || effect.quantity_delta === 0) {
          return isAr ? `تأثير المخزون غير صالح: ${option.name}` : `Invalid inventory effect: ${option.name}`;
        }
      }
    }
    return null;
  };

  const saveGroup = async (groupIndex: number) => {
    if (!branchFilter || !canManage) return;
    const group = groups[groupIndex];
    const validationError = validateGroup(group);
    if (validationError) { show(validationError, 'error'); return; }

    setSavingIndex(groupIndex);
    try {
      const payload = {
        name: group.name.trim(),
        name_en: group.name_en.trim() || null,
        min_selections: group.min_selections,
        max_selections: group.max_selections,
        sort_order: groupIndex,
        options: group.options.map((option, oi) => ({
          id: option.id || undefined,
          name: option.name.trim(),
          name_en: option.name_en.trim() || null,
          price_delta: Number(option.price_delta || 0),
          is_default: !!option.is_default,
          sort_order: oi,
          inventory_effects: option.inventory_effects.map((effect) => ({
            target_type: effect.target_type,
            target_id: effect.target_id,
            quantity_delta: Number(effect.quantity_delta),
          })),
        })),
      };
      const { data, error } = await api.catalog.saveModifierGroup({
        p_group_id: group.id || null,
        p_branch_id: branchFilter,
        p_group: payload,
        p_product_ids: group.product_ids,
      });
      if (error) throw error;
      const result = (data || {}) as { success?: boolean; error?: string; detail?: string };
      if (!result.success) throw new Error(result.detail || result.error || 'SAVE_MODIFIER_GROUP_FAILED');
      show(isAr ? 'تم حفظ المجموعة وربط المنتجات' : 'Modifier group and product links saved', 'success');
      await load();
    } catch (err) {
      show(err instanceof Error ? err.message : 'Failed to save modifier group', 'error');
    } finally {
      setSavingIndex(null);
    }
  };

  const archiveGroup = async (group: ModifierGroupDraft) => {
    if (!group.id || !canManage) return;
    setArchivingId(group.id);
    try {
      const { data, error } = await supabase.rpc('archive_modifier_group', { p_group_id: group.id });
      if (error) throw error;
      const result = (data || {}) as { success?: boolean; error?: string; detail?: string };
      if (!result.success) throw new Error(result.detail || result.error || 'ARCHIVE_MODIFIER_GROUP_FAILED');
      show(isAr ? 'تمت أرشفة المجموعة' : 'Modifier group archived', 'success');
      await load();
    } catch (err) {
      show(err instanceof Error ? err.message : 'Failed to archive modifier group', 'error');
    } finally {
      setArchivingId(null);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-ui-text">{isAr ? 'مجموعات الموديفاير' : 'Modifier Groups'}</h1>
          <p className="text-sm text-ui-muted mt-1">
            {isAr ? 'أنشئ المجموعة مرة واحدة، أضف اختياراتها، ثم اربطها بأي عدد من منتجات الفرع.' : 'Create a group once, add its choices, then attach it to any number of branch products.'}
          </p>
        </div>
        {canManage && branchFilter && (
          <button
            onClick={() => setGroups((prev) => [...prev, emptyGroup(prev.length)])}
            className="min-h-11 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-ui-primary text-ui-primary-fg font-bold"
          >
            <Plus className="w-4 h-4" /> {isAr ? 'مجموعة جديدة' : 'New group'}
          </button>
        )}
      </div>

      {!branchFilter ? (
        <div className="rounded-2xl border border-ui-border bg-ui-surface p-5 text-center text-ui-muted">
          {isAr ? 'اختر الفرع من أعلى الصفحة أولًا.' : 'Select the active branch first.'}
        </div>
      ) : !canManage ? (
        <div className="rounded-2xl border border-ui-border bg-ui-surface p-5 text-center text-ui-muted">
          {isAr ? 'ليس لديك صلاحية إدارة موديفاير المنتجات.' : 'You do not have permission to manage product modifiers.'}
        </div>
      ) : loading ? (
        <div className="py-16 text-center text-ui-muted">{isAr ? 'جاري التحميل…' : 'Loading…'}</div>
      ) : groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-ui-border bg-ui-surface p-10 text-center text-ui-muted">
          {isAr ? 'لا توجد مجموعات بعد. أنشئ أول مجموعة واربطها بالمنتجات المطلوبة.' : 'No groups yet. Create the first group and attach products.'}
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group, gi) => (
            <section key={group.id || `new-${gi}`} className="rounded-2xl border border-ui-border bg-ui-surface p-4 space-y-4">
              <div className="grid md:grid-cols-[1fr_1fr_110px_110px_auto] gap-3 items-end">
                <label className="text-sm font-semibold">{isAr ? 'اسم المجموعة' : 'Group name'}
                  <input value={group.name} onChange={(e) => updateGroup(gi, { name: e.target.value })} className="mt-1 w-full min-h-11 rounded-xl border border-ui-border bg-ui-page px-3" />
                </label>
                <label className="text-sm font-semibold">English
                  <input value={group.name_en} onChange={(e) => updateGroup(gi, { name_en: e.target.value })} className="mt-1 w-full min-h-11 rounded-xl border border-ui-border bg-ui-page px-3" />
                </label>
                <label className="text-sm font-semibold">{isAr ? 'أقل عدد' : 'Min'}
                  <input type="number" min={0} value={group.min_selections} onChange={(e) => updateGroup(gi, { min_selections: Number(e.target.value) })} className="mt-1 w-full min-h-11 rounded-xl border border-ui-border bg-ui-page px-3" />
                </label>
                <label className="text-sm font-semibold">{isAr ? 'أقصى عدد' : 'Max'}
                  <input type="number" min={1} value={group.max_selections} onChange={(e) => updateGroup(gi, { max_selections: Number(e.target.value) })} className="mt-1 w-full min-h-11 rounded-xl border border-ui-border bg-ui-page px-3" />
                </label>
                <div className="flex gap-2">
                  <button onClick={() => void saveGroup(gi)} disabled={savingIndex === gi} className="min-h-11 px-3 rounded-xl bg-ui-primary text-ui-primary-fg inline-flex items-center justify-center gap-2 disabled:opacity-50" title={isAr ? 'حفظ المجموعة' : 'Save group'}><Save className="w-4 h-4" /></button>
                  {group.id && <button onClick={() => void archiveGroup(group)} disabled={archivingId === group.id} className="min-h-11 px-3 rounded-xl border border-ui-danger/40 text-ui-danger inline-flex items-center justify-center disabled:opacity-50" title={isAr ? 'أرشفة المجموعة' : 'Archive group'}><Archive className="w-4 h-4" /></button>}
                </div>
              </div>

              <div className="rounded-xl border border-ui-border bg-ui-page p-3">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div>
                    <div className="text-sm font-bold">{isAr ? 'المنتجات المرتبطة' : 'Attached products'}</div>
                    <div className="text-xs text-ui-muted">{isAr ? `${group.product_ids.length} منتج — اختر أو ألغِ المنتجات ثم احفظ المجموعة` : `${group.product_ids.length} products — select products then save the group`}</div>
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-52 overflow-y-auto pr-1">
                  {products.map((product) => (
                    <label key={product.id} className="min-h-10 flex items-center gap-2 rounded-lg border border-ui-border bg-ui-surface px-3 py-2 cursor-pointer">
                      <input type="checkbox" checked={group.product_ids.includes(product.id)} onChange={() => toggleProduct(gi, product.id)} />
                      <span className="text-sm font-medium truncate">{product.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-bold">{isAr ? 'اختيارات المجموعة' : 'Group choices'}</div>
                  <span className="text-xs text-ui-muted">{group.options.length}</span>
                </div>
                {group.options.map((option, oi) => (
                  <details key={option.id || `option-${gi}-${oi}`} className="rounded-xl border border-ui-border bg-ui-page p-3" open>
                    <summary className="cursor-pointer list-none flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <ChevronDown className="w-4 h-4 shrink-0" />
                        <span className="font-bold truncate">{option.name || (isAr ? 'اختيار جديد' : 'New option')}</span>
                        {option.price_delta !== 0 && <span className="text-xs text-ui-muted">({formatNumber(Number(option.price_delta), 1)})</span>}
                      </div>
                      <button type="button" onClick={(e) => { e.preventDefault(); updateGroup(gi, { options: group.options.filter((_, index) => index !== oi) }); }} className="p-2 rounded-lg text-ui-danger hover:bg-ui-danger-soft"><Trash2 className="w-4 h-4" /></button>
                    </summary>

                    <div className="mt-3 space-y-3">
                      <div className="grid md:grid-cols-[1fr_1fr_140px_120px] gap-3 items-end">
                        <label className="text-xs font-semibold">{isAr ? 'اسم الاختيار' : 'Option name'}
                          <input value={option.name} onChange={(e) => updateOption(gi, oi, { name: e.target.value })} className="mt-1 w-full min-h-11 rounded-lg border border-ui-border bg-ui-surface px-3" />
                        </label>
                        <label className="text-xs font-semibold">English
                          <input value={option.name_en} onChange={(e) => updateOption(gi, oi, { name_en: e.target.value })} className="mt-1 w-full min-h-11 rounded-lg border border-ui-border bg-ui-surface px-3" />
                        </label>
                        <label className="text-xs font-semibold">{isAr ? 'فرق السعر' : 'Price delta'}
                          <input type="number" step="0.01" value={option.price_delta} onChange={(e) => updateOption(gi, oi, { price_delta: Number(e.target.value) })} className="mt-1 w-full min-h-11 rounded-lg border border-ui-border bg-ui-surface px-3" />
                        </label>
                        <label className="min-h-11 flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={option.is_default} onChange={(e) => updateOption(gi, oi, { is_default: e.target.checked })} />{isAr ? 'افتراضي' : 'Default'}</label>
                      </div>

                      <div className="rounded-lg border border-ui-border bg-ui-surface p-3 space-y-2">
                        <div className="text-xs font-bold text-ui-muted">{isAr ? 'تأثير المخزون (اختياري)' : 'Inventory effect (optional)'}</div>
                        {option.inventory_effects.map((effect, ei) => {
                          const targets = effect.target_type === 'raw_material' ? rawMaterials : inventoryUnits;
                          return (
                            <div key={`${gi}-${oi}-${ei}`} className="grid md:grid-cols-[160px_1fr_150px_auto] gap-2">
                              <select value={effect.target_type} onChange={(e) => updateEffect(gi, oi, ei, { target_type: e.target.value as EffectTarget, target_id: '' })} className="min-h-11 rounded-lg border border-ui-border bg-ui-page px-2"><option value="raw_material">{isAr ? 'خامة' : 'Raw material'}</option><option value="inventory_unit">{isAr ? 'مصنع' : 'Manufactured item'}</option></select>
                              <select value={effect.target_id} onChange={(e) => updateEffect(gi, oi, ei, { target_id: e.target.value })} className="min-h-11 rounded-lg border border-ui-border bg-ui-page px-2"><option value="">{isAr ? 'اختر المكوّن' : 'Select component'}</option>{targets.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}</select>
                              <input type="number" step="0.0001" value={effect.quantity_delta} onChange={(e) => updateEffect(gi, oi, ei, { quantity_delta: Number(e.target.value) })} className="min-h-11 rounded-lg border border-ui-border bg-ui-page px-3" title={isAr ? 'موجب للإضافة، سالب للحذف' : 'Positive to add, negative to remove'} />
                              <button type="button" onClick={() => updateOption(gi, oi, { inventory_effects: option.inventory_effects.filter((_, index) => index !== ei) })} className="min-h-11 px-3 rounded-lg border border-ui-danger/40 text-ui-danger"><Trash2 className="w-4 h-4" /></button>
                            </div>
                          );
                        })}
                        <button type="button" onClick={() => updateOption(gi, oi, { inventory_effects: [...option.inventory_effects, { target_type: 'raw_material', target_id: '', quantity_delta: 1 }] })} className="min-h-10 inline-flex items-center gap-2 px-3 rounded-lg border border-ui-border text-sm font-semibold"><Plus className="w-4 h-4" />{isAr ? 'إضافة تأثير' : 'Add effect'}</button>
                      </div>
                    </div>
                  </details>
                ))}
                <button type="button" onClick={() => updateGroup(gi, { options: [...group.options, emptyOption(group.options.length)] })} className="min-h-11 inline-flex items-center gap-2 px-4 rounded-xl border border-ui-border font-bold"><Plus className="w-4 h-4" />{isAr ? 'إضافة اختيار' : 'Add choice'}</button>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}