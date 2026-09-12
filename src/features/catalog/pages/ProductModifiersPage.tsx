import { useEffect, useMemo, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { supabase } from '@/api';
import * as api from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { useBranchFilter } from '@/lib/useBranchFilter';
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
  options: ModifierOptionDraft[];
}

type AdminModifiersResponse = {
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

export function ProductModifiersPage() {
  const { lang } = useLanguage();
  const isAr = lang === 'ar';
  const { show } = useToast();
  const branchFilter = useBranchFilter();
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState('');
  const [groups, setGroups] = useState<ModifierGroupDraft[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawMaterialRef[]>([]);
  const [inventoryUnits, setInventoryUnits] = useState<InventoryUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === productId) || null,
    [products, productId],
  );

  useEffect(() => {
    let cancelled = false;
    if (!branchFilter) {
      setProducts([]);
      setProductId('');
      setGroups([]);
      setRawMaterials([]);
      setInventoryUnits([]);
      setLoading(false);
      return () => { cancelled = true; };
    }

    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('branch_id', branchFilter)
        .eq('is_active', true)
        .order('name');
      if (cancelled) return;
      if (error) {
        show(error.message, 'error');
        setProducts([]);
        setProductId('');
        setLoading(false);
        return;
      }
      const rows = (data || []) as Product[];
      setProducts(rows);
      setProductId((prev) => rows.some((row) => row.id === prev) ? prev : (rows[0]?.id || ''));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [branchFilter, show]);

  useEffect(() => {
    if (!branchFilter || !selectedProduct || selectedProduct.branch_id !== branchFilter) {
      setGroups([]);
      setRawMaterials([]);
      setInventoryUnits([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [mods, raws, units] = await Promise.all([
        api.catalog.getProductModifiersAdmin(selectedProduct.id),
        supabase.from('raw_materials').select('id,name,branch_id').eq('branch_id', branchFilter).eq('is_active', true).order('name'),
        api.catalog.listInventoryUnits({ branch_id: branchFilter, is_active: true }),
      ]);
      if (cancelled) return;
      if (mods.error) {
        show(mods.error.message, 'error');
        setGroups([]);
      } else {
        const result = (mods.data || {}) as AdminModifiersResponse;
        if (!result.success) show(result.detail || result.error || 'Failed to load modifiers', 'error');
        setGroups((result.groups || []).map((g, gi) => ({
          ...g,
          name_en: g.name_en || '',
          sort_order: Number(g.sort_order ?? gi),
          min_selections: Number(g.min_selections || 0),
          max_selections: Number(g.max_selections || 1),
          options: (g.options || []).map((o, oi) => ({
            ...o,
            name_en: o.name_en || '',
            price_delta: Number(o.price_delta || 0),
            sort_order: Number(o.sort_order ?? oi),
            is_default: !!o.is_default,
            inventory_effects: (o.inventory_effects || []).map((e) => ({
              target_type: e.target_type,
              target_id: e.target_id,
              quantity_delta: Number(e.quantity_delta || 0),
            })),
          })),
        })));
      }
      if (raws.error) show(raws.error.message, 'error');
      setRawMaterials((raws.data || []) as RawMaterialRef[]);
      setInventoryUnits((units || []) as InventoryUnit[]);
      setLoading(false);
    })().catch((err) => {
      if (!cancelled) {
        show(err instanceof Error ? err.message : 'Failed to load modifiers', 'error');
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [branchFilter, selectedProduct, show]);

  const updateGroup = (groupIndex: number, patch: Partial<ModifierGroupDraft>) => {
    setGroups((prev) => prev.map((g, i) => i === groupIndex ? { ...g, ...patch } : g));
  };

  const updateOption = (groupIndex: number, optionIndex: number, patch: Partial<ModifierOptionDraft>) => {
    setGroups((prev) => prev.map((g, gi) => gi === groupIndex
      ? { ...g, options: g.options.map((o, oi) => oi === optionIndex ? { ...o, ...patch } : o) }
      : g));
  };

  const updateEffect = (groupIndex: number, optionIndex: number, effectIndex: number, patch: Partial<ModifierEffectDraft>) => {
    setGroups((prev) => prev.map((g, gi) => gi === groupIndex
      ? {
          ...g,
          options: g.options.map((o, oi) => oi === optionIndex
            ? { ...o, inventory_effects: o.inventory_effects.map((e, ei) => ei === effectIndex ? { ...e, ...patch } : e) }
            : o),
        }
      : g));
  };

  const save = async () => {
    if (!branchFilter || !selectedProduct || selectedProduct.branch_id !== branchFilter) return;
    for (const group of groups) {
      if (!group.name.trim()) {
        show(isAr ? 'اسم مجموعة الإضافات مطلوب' : 'Modifier group name is required', 'error');
        return;
      }
      if (group.min_selections < 0 || group.max_selections < 1 || group.max_selections < group.min_selections || group.max_selections > group.options.length) {
        show(isAr ? `اختيارات المجموعة غير صالحة: ${group.name}` : `Invalid group selection limits: ${group.name}`, 'error');
        return;
      }
      for (const option of group.options) {
        if (!option.name.trim()) {
          show(isAr ? 'اسم الاختيار مطلوب' : 'Modifier option name is required', 'error');
          return;
        }
        for (const effect of option.inventory_effects) {
          if (!effect.target_id || !Number.isFinite(effect.quantity_delta) || effect.quantity_delta === 0) {
            show(isAr ? `تأثير المخزون غير صالح: ${option.name}` : `Invalid inventory effect: ${option.name}`, 'error');
            return;
          }
        }
      }
    }

    setSaving(true);
    try {
      const payload = groups.map((g, gi) => ({
        name: g.name.trim(),
        name_en: g.name_en.trim() || null,
        min_selections: g.min_selections,
        max_selections: g.max_selections,
        sort_order: gi,
        options: g.options.map((o, oi) => ({
          name: o.name.trim(),
          name_en: o.name_en.trim() || null,
          price_delta: Number(o.price_delta || 0),
          is_default: !!o.is_default,
          sort_order: oi,
          inventory_effects: o.inventory_effects.map((e) => ({
            target_type: e.target_type,
            target_id: e.target_id,
            quantity_delta: Number(e.quantity_delta),
          })),
        })),
      }));
      const { data, error } = await api.catalog.saveProductModifiers(selectedProduct.id, payload);
      if (error) throw error;
      const result = (data || {}) as { success?: boolean; error?: string; detail?: string };
      if (!result.success) throw new Error(result.detail || result.error || 'SAVE_MODIFIERS_FAILED');
      show(isAr ? 'تم حفظ الموديفاير والمكونات بنجاح' : 'Modifiers and component effects saved', 'success');
    } catch (err) {
      show(err instanceof Error ? err.message : 'Failed to save modifiers', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-ui-text">{isAr ? 'موديفاير المنتجات' : 'Product Modifiers'}</h1>
          <p className="text-sm text-ui-muted mt-1">
            {isAr ? 'سنجل / دبل / إضافات / حذف مكونات — السعر والمخزون يتحكمان من الخادم.' : 'Single / Double / extras / removals — pricing and inventory stay server-controlled.'}
          </p>
        </div>
        <button
          onClick={save}
          disabled={!branchFilter || !selectedProduct || saving || loading}
          className="min-h-11 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-ui-primary text-ui-primary-fg font-bold disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {saving ? (isAr ? 'جاري الحفظ…' : 'Saving…') : (isAr ? 'حفظ الإعداد' : 'Save configuration')}
        </button>
      </div>

      {!branchFilter ? (
        <div className="rounded-2xl border border-ui-border bg-ui-surface p-5 text-center text-ui-muted">
          {isAr ? 'اختر فرعًا محددًا من محدد الفروع لعرض موديفاير هذا الفرع فقط.' : 'Select a specific branch to manage only that branch’s modifiers.'}
        </div>
      ) : (
        <div className="rounded-2xl border border-ui-border bg-ui-surface p-4">
          <label className="block text-sm font-bold mb-2">{isAr ? 'المنتج' : 'Product'}</label>
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            className="w-full md:max-w-xl min-h-11 rounded-xl border border-ui-border bg-ui-page px-3"
          >
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.name_en ? ` — ${p.name_en}` : ''}</option>)}
          </select>
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center text-ui-muted">{isAr ? 'جاري التحميل…' : 'Loading…'}</div>
      ) : !branchFilter ? null : !selectedProduct ? (
        <div className="py-16 text-center text-ui-muted">{isAr ? 'لا توجد منتجات متاحة في هذا الفرع' : 'No products available in this branch'}</div>
      ) : (
        <div className="space-y-4">
          {groups.map((group, gi) => (
            <section key={group.id || `g-${gi}`} className="rounded-2xl border border-ui-border bg-ui-surface p-4 space-y-4">
              <div className="grid md:grid-cols-[1fr_1fr_110px_110px_auto] gap-3 items-end">
                <label className="text-sm font-semibold">{isAr ? 'اسم المجموعة' : 'Group name'}
                  <input value={group.name} onChange={(e) => updateGroup(gi, { name: e.target.value })} className="mt-1 w-full min-h-11 rounded-xl border border-ui-border bg-ui-page px-3" />
                </label>
                <label className="text-sm font-semibold">English
                  <input value={group.name_en} onChange={(e) => updateGroup(gi, { name_en: e.target.value })} className="mt-1 w-full min-h-11 rounded-xl border border-ui-border bg-ui-page px-3" />
                </label>
                <label className="text-sm font-semibold">Min
                  <input type="number" min={0} value={group.min_selections} onChange={(e) => updateGroup(gi, { min_selections: Number(e.target.value) })} className="mt-1 w-full min-h-11 rounded-xl border border-ui-border bg-ui-page px-3" />
                </label>
                <label className="text-sm font-semibold">Max
                  <input type="number" min={1} value={group.max_selections} onChange={(e) => updateGroup(gi, { max_selections: Number(e.target.value) })} className="mt-1 w-full min-h-11 rounded-xl border border-ui-border bg-ui-page px-3" />
                </label>
                <button onClick={() => setGroups((prev) => prev.filter((_, i) => i !== gi))} className="min-h-11 px-3 rounded-xl border border-ui-danger/40 text-ui-danger inline-flex items-center justify-center"><Trash2 className="w-4 h-4" /></button>
              </div>

              <div className="space-y-3">
                {group.options.map((option, oi) => (
                  <div key={option.id || `o-${gi}-${oi}`} className="rounded-xl border border-ui-border bg-ui-page p-3 space-y-3">
                    <div className="grid md:grid-cols-[1fr_1fr_130px_110px_auto] gap-3 items-end">
                      <label className="text-xs font-semibold">{isAr ? 'الاختيار' : 'Option'}
                        <input value={option.name} onChange={(e) => updateOption(gi, oi, { name: e.target.value })} className="mt-1 w-full min-h-11 rounded-lg border border-ui-border bg-ui-surface px-3" />
                      </label>
                      <label className="text-xs font-semibold">English
                        <input value={option.name_en} onChange={(e) => updateOption(gi, oi, { name_en: e.target.value })} className="mt-1 w-full min-h-11 rounded-lg border border-ui-border bg-ui-surface px-3" />
                      </label>
                      <label className="text-xs font-semibold">{isAr ? 'فرق السعر' : 'Price delta'}
                        <input type="number" step="0.01" value={option.price_delta} onChange={(e) => updateOption(gi, oi, { price_delta: Number(e.target.value) })} className="mt-1 w-full min-h-11 rounded-lg border border-ui-border bg-ui-surface px-3" />
                      </label>
                      <label className="min-h-11 flex items-center gap-2 text-xs font-semibold">
                        <input type="checkbox" checked={option.is_default} onChange={(e) => updateOption(gi, oi, { is_default: e.target.checked })} />
                        {isAr ? 'افتراضي' : 'Default'}
                      </label>
                      <button onClick={() => updateGroup(gi, { options: group.options.filter((_, i) => i !== oi) })} className="min-h-11 px-3 rounded-lg border border-ui-danger/40 text-ui-danger inline-flex items-center justify-center"><Trash2 className="w-4 h-4" /></button>
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-bold text-ui-muted">{isAr ? 'تأثير المكونات / المخزون' : 'Component / inventory effects'}</div>
                      {option.inventory_effects.map((effect, ei) => {
                        const targets = effect.target_type === 'raw_material' ? rawMaterials : inventoryUnits;
                        return (
                          <div key={`${gi}-${oi}-${ei}`} className="grid md:grid-cols-[160px_1fr_150px_auto] gap-2">
                            <select value={effect.target_type} onChange={(e) => updateEffect(gi, oi, ei, { target_type: e.target.value as EffectTarget, target_id: '' })} className="min-h-11 rounded-lg border border-ui-border bg-ui-surface px-2">
                              <option value="raw_material">{isAr ? 'خامة' : 'Raw material'}</option>
                              <option value="inventory_unit">{isAr ? 'وحدة مخزون' : 'Inventory unit'}</option>
                            </select>
                            <select value={effect.target_id} onChange={(e) => updateEffect(gi, oi, ei, { target_id: e.target.value })} className="min-h-11 rounded-lg border border-ui-border bg-ui-surface px-2">
                              <option value="">{isAr ? 'اختر المكوّن' : 'Select component'}</option>
                              {targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                            <input type="number" step="0.0001" value={effect.quantity_delta} onChange={(e) => updateEffect(gi, oi, ei, { quantity_delta: Number(e.target.value) })} className="min-h-11 rounded-lg border border-ui-border bg-ui-surface px-3" title={isAr ? 'موجب للإضافة، سالب للحذف' : 'Positive to add, negative to remove'} />
                            <button onClick={() => updateOption(gi, oi, { inventory_effects: option.inventory_effects.filter((_, i) => i !== ei) })} className="min-h-11 px-3 rounded-lg border border-ui-danger/40 text-ui-danger inline-flex items-center justify-center"><Trash2 className="w-4 h-4" /></button>
                          </div>
                        );
                      })}
                      <button
                        onClick={() => updateOption(gi, oi, { inventory_effects: [...option.inventory_effects, { target_type: 'raw_material', target_id: '', quantity_delta: 1 }] })}
                        className="min-h-10 inline-flex items-center gap-2 px-3 rounded-lg border border-ui-border text-sm font-semibold"
                      >
                        <Plus className="w-4 h-4" /> {isAr ? 'إضافة تأثير مكوّن' : 'Add component effect'}
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  onClick={() => updateGroup(gi, { options: [...group.options, emptyOption(group.options.length)] })}
                  className="min-h-11 inline-flex items-center gap-2 px-4 rounded-xl border border-ui-border font-bold"
                >
                  <Plus className="w-4 h-4" /> {isAr ? 'إضافة اختيار' : 'Add option'}
                </button>
              </div>
            </section>
          ))}

          <button
            onClick={() => setGroups((prev) => [...prev, emptyGroup(prev.length)])}
            className="min-h-11 inline-flex items-center gap-2 px-4 rounded-xl bg-ui-surface border border-ui-border font-bold"
          >
            <Plus className="w-4 h-4" /> {isAr ? 'إضافة مجموعة موديفاير' : 'Add modifier group'}
          </button>
        </div>
      )}
    </div>
  );
}