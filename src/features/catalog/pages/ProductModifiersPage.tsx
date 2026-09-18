import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, Plus, Save, Search } from 'lucide-react';
import { supabase } from '@/api';
import * as api from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useCan } from '@/lib/permissions';
import type { Product } from '@/lib/types';

type InventoryEffect = {
  target_type: 'raw_material' | 'inventory_unit';
  target_id: string;
  quantity_delta: number;
};

type ModifierRow = {
  id?: string;
  option_id?: string;
  name: string;
  name_en: string;
  price_delta: number;
  product_ids: string[];
  inventory_effects: InventoryEffect[];
};

type AdminGroup = {
  id?: string;
  name?: string;
  name_en?: string | null;
  product_ids?: string[];
  options?: Array<{
    id?: string;
    name?: string;
    name_en?: string | null;
    price_delta?: number;
    inventory_effects?: InventoryEffect[];
  }>;
};

type AdminGroupsResponse = {
  success?: boolean;
  error?: string;
  detail?: string;
  groups?: AdminGroup[];
};

const newModifier = (): ModifierRow => ({
  name: '',
  name_en: '',
  price_delta: 0,
  product_ids: [],
  inventory_effects: [],
});

const normalize = (groups: AdminGroup[]): ModifierRow[] => groups.map((group) => {
  const option = group.options?.[0];
  return {
    id: group.id,
    option_id: option?.id,
    name: option?.name || group.name || '',
    name_en: option?.name_en || group.name_en || '',
    price_delta: Number(option?.price_delta || 0),
    product_ids: Array.isArray(group.product_ids) ? group.product_ids : [],
    inventory_effects: Array.isArray(option?.inventory_effects) ? option!.inventory_effects! : [],
  };
});

export function ProductModifiersPage() {
  const { lang } = useLanguage();
  const isAr = lang === 'ar';
  const { show } = useToast();
  const can = useCan();
  const canManage = can('products.modifiers.manage');
  const branchFilter = useBranchFilter();

  const [products, setProducts] = useState<Product[]>([]);
  const [modifiers, setModifiers] = useState<ModifierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingIndex, setSavingIndex] = useState<number | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    if (!branchFilter) {
      setProducts([]);
      setModifiers([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [productResult, groupsResult] = await Promise.all([
        supabase.from('products').select('*').eq('branch_id', branchFilter).eq('is_active', true).order('name'),
        api.catalog.listModifierGroupsAdmin(branchFilter),
      ]);

      if (productResult.error) throw productResult.error;
      if (groupsResult.error) throw groupsResult.error;

      const result = (groupsResult.data || {}) as AdminGroupsResponse;
      if (!result.success) throw new Error(result.detail || result.error || 'LOAD_MODIFIERS_FAILED');

      setProducts((productResult.data || []) as Product[]);
      setModifiers(normalize(result.groups || []));
    } catch (err) {
      show(err instanceof Error ? err.message : 'Failed to load modifiers', 'error');
      setModifiers([]);
    } finally {
      setLoading(false);
    }
  }, [branchFilter, show]);

  useEffect(() => { void load(); }, [load]);

  const visibleProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter((product) => `${product.name} ${product.name_en || ''}`.toLowerCase().includes(q));
  }, [products, search]);

  const updateModifier = (index: number, patch: Partial<ModifierRow>) => {
    setModifiers((prev) => prev.map((row, i) => i === index ? { ...row, ...patch } : row));
  };

  const toggleProduct = (index: number, productId: string) => {
    const row = modifiers[index];
    const productIds = row.product_ids.includes(productId)
      ? row.product_ids.filter((id) => id !== productId)
      : [...row.product_ids, productId];
    updateModifier(index, { product_ids: productIds });
  };

  const saveModifier = async (index: number) => {
    if (!branchFilter || !canManage) return;
    const row = modifiers[index];
    const name = row.name.trim();
    if (!name) {
      show(isAr ? 'اسم الموديفاير مطلوب' : 'Modifier name is required', 'error');
      return;
    }
    if (row.product_ids.length === 0) {
      show(isAr ? 'عيّن منتجًا واحدًا على الأقل للموديفاير' : 'Assign at least one product to the modifier', 'error');
      return;
    }

    setSavingIndex(index);
    try {
      const payload = {
        name,
        name_en: row.name_en.trim() || null,
        min_selections: 0,
        max_selections: 1,
        sort_order: index,
        options: [{
          id: row.option_id || undefined,
          name,
          name_en: row.name_en.trim() || null,
          price_delta: Number(row.price_delta || 0),
          is_default: false,
          sort_order: 0,
          inventory_effects: row.inventory_effects,
        }],
      };

      const { data, error } = await api.catalog.saveModifierGroup({
        p_group_id: row.id || null,
        p_branch_id: branchFilter,
        p_group: payload,
        p_product_ids: row.product_ids,
      });
      if (error) throw error;

      const result = (data || {}) as { success?: boolean; error?: string; detail?: string };
      if (!result.success) throw new Error(result.detail || result.error || 'SAVE_MODIFIER_FAILED');

      show(isAr ? 'تم حفظ الموديفاير وربطه بالمنتجات' : 'Modifier saved and assigned to products', 'success');
      await load();
    } catch (err) {
      show(err instanceof Error ? err.message : 'Failed to save modifier', 'error');
    } finally {
      setSavingIndex(null);
    }
  };

  const archiveModifier = async (row: ModifierRow) => {
    if (!row.id || !canManage) return;
    setArchivingId(row.id);
    try {
      const { data, error } = await api.catalog.archiveModifierGroup(row.id);
      if (error) throw error;
      const result = (data || {}) as { success?: boolean; error?: string; detail?: string };
      if (!result.success) {
        if (result.error === 'MODIFIER_GROUP_HAS_OPEN_ORDERS') {
          throw new Error(isAr
            ? 'لا يمكن إزالة هذا الموديفاير الآن لأن منتجاته موجودة في طلبات مفتوحة. أغلق الطلبات أولًا ثم أعد المحاولة.'
            : 'This modifier cannot be removed while its products are present in open orders. Close those orders first.');
        }
        throw new Error(result.detail || result.error || 'ARCHIVE_MODIFIER_FAILED');
      }
      show(isAr ? 'تم حذف الموديفاير من الاستخدام' : 'Modifier removed from active use', 'success');
      await load();
    } catch (err) {
      show(err instanceof Error ? err.message : 'Failed to remove modifier', 'error');
    } finally {
      setArchivingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-black text-ui-text">{isAr ? 'الموديفاير' : 'Modifiers'}</h1>
          <p className="mt-1 text-sm text-ui-muted">
            {isAr
              ? 'كل موديفاير له اسم واحد ظاهر في نقطة البيع، ويمكن تعيينه مباشرة لأي منتجات تريدها.'
              : 'Each modifier has one visible POS name and can be assigned directly to selected products.'}
          </p>
        </div>
        {canManage && branchFilter && (
          <button
            type="button"
            onClick={() => setModifiers((prev) => [...prev, newModifier()])}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-ui-primary px-4 py-2 font-bold text-ui-primary-fg"
          >
            <Plus className="h-4 w-4" /> {isAr ? 'موديفاير جديد' : 'New modifier'}
          </button>
        )}
      </div>

      {!branchFilter ? (
        <div className="rounded-2xl border border-ui-border bg-ui-surface p-6 text-center text-ui-muted">
          {isAr ? 'اختر الفرع أولًا.' : 'Select the active branch first.'}
        </div>
      ) : !canManage ? (
        <div className="rounded-2xl border border-ui-border bg-ui-surface p-6 text-center text-ui-muted">
          {isAr ? 'ليس لديك صلاحية إدارة الموديفاير.' : 'You do not have permission to manage modifiers.'}
        </div>
      ) : loading ? (
        <div className="py-16 text-center text-ui-muted">{isAr ? 'جاري التحميل…' : 'Loading…'}</div>
      ) : (
        <div className="space-y-4">
          {modifiers.length === 0 && (
            <div className="rounded-2xl border border-dashed border-ui-border bg-ui-surface p-10 text-center text-ui-muted">
              {isAr ? 'لا يوجد موديفاير حاليًا. أضف أول موديفاير وحدد المنتجات الخاصة به.' : 'No modifiers yet. Add one and assign its products.'}
            </div>
          )}

          {modifiers.map((row, index) => (
            <section key={row.id || `new-${index}`} className="space-y-4 rounded-2xl border border-ui-border bg-ui-surface p-4">
              <div className="grid gap-3 md:grid-cols-[1.2fr_1.2fr_160px_auto] md:items-end">
                <label className="text-sm font-semibold text-ui-text">
                  {isAr ? 'اسم الموديفاير' : 'Modifier name'}
                  <input
                    value={row.name}
                    onChange={(e) => updateModifier(index, { name: e.target.value })}
                    className="mt-1 min-h-11 w-full rounded-xl border border-ui-border bg-ui-page px-3"
                    placeholder={isAr ? 'مثال: أمريكان تشيز' : 'e.g. American cheese'}
                  />
                </label>
                <label className="text-sm font-semibold text-ui-text">
                  English
                  <input
                    value={row.name_en}
                    onChange={(e) => updateModifier(index, { name_en: e.target.value })}
                    className="mt-1 min-h-11 w-full rounded-xl border border-ui-border bg-ui-page px-3"
                  />
                </label>
                <label className="text-sm font-semibold text-ui-text">
                  {isAr ? 'فرق السعر' : 'Price delta'}
                  <input
                    type="number"
                    step="0.01"
                    value={row.price_delta}
                    onChange={(e) => updateModifier(index, { price_delta: Number(e.target.value) || 0 })}
                    className="mt-1 min-h-11 w-full rounded-xl border border-ui-border bg-ui-page px-3"
                  />
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void saveModifier(index)}
                    disabled={savingIndex === index}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-ui-primary px-4 font-bold text-ui-primary-fg disabled:opacity-50"
                  >
                    <Save className="h-4 w-4" /> {isAr ? 'حفظ' : 'Save'}
                  </button>
                  {row.id && (
                    <button
                      type="button"
                      onClick={() => void archiveModifier(row)}
                      disabled={archivingId === row.id}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-ui-danger/40 px-3 font-bold text-ui-danger disabled:opacity-50"
                    >
                      <Archive className="h-4 w-4" /> {isAr ? 'حذف' : 'Remove'}
                    </button>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-ui-border bg-ui-page-alt p-3">
                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-black text-ui-text">{isAr ? 'المنتجات المعيّن لها الموديفاير' : 'Assigned products'}</p>
                    <p className="text-xs text-ui-muted">
                      {isAr ? `مختار ${row.product_ids.length} من ${products.length}` : `${row.product_ids.length} of ${products.length} selected`}
                    </p>
                  </div>
                  <div className="relative w-full sm:max-w-xs">
                    <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ui-subtle" />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder={isAr ? 'بحث في المنتجات' : 'Search products'}
                      className="min-h-10 w-full rounded-xl border border-ui-border bg-ui-surface ps-9 pe-3 text-sm"
                    />
                  </div>
                </div>

                <div className="grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {visibleProducts.map((product) => {
                    const checked = row.product_ids.includes(product.id);
                    return (
                      <label key={product.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-ui-border bg-ui-surface px-3 py-2 text-sm text-ui-text">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleProduct(index, product.id)}
                          className="h-4 w-4"
                        />
                        <span className="min-w-0 truncate">{isAr ? product.name : product.name_en || product.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
