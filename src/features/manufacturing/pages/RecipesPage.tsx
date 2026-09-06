import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Edit2, Trash2, ChefHat, Calculator, Package } from 'lucide-react';
import { supabase } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { useCan } from '@/lib/permissions';
import { useAuth } from '@/context/AuthContext';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { DesignSurface, DesignPageHeader, DesignSearch, DesignPanel, DesignPagination } from '@/components/design';
import { DataTable, type Column } from '@/components/DataTable';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { formatCurrency, formatNumber } from '@/lib/format';
import { logAudit } from '@/lib/audit';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import type { Recipe, RecipeItem, RawMaterial, Product, Branch, RecipeItemInput } from '@/lib/types';

interface ItemForm {
  raw_material_id: string;
  quantity: number;
  wastage_percent: number;
}

interface RecipeMutationResult {
  success?: boolean;
  error?: string;
  detail?: string;
}

const EMPTY_ITEM: ItemForm = { raw_material_id: '', quantity: 1, wastage_percent: 0 };

export function RecipesPage() {
  const { t, lang } = useLanguage();
  const { show } = useToast();
  const can = useCan();
  const { user } = useAuth();
  const branchFilter = useBranchFilter();
  const isAr = lang === 'ar';

  const { rows: recipes, loading, error, total, hasMore, loadMore, loadingMore, refresh: reloadRecipes } = usePaginatedRows<Recipe>({
    table: 'recipes',
    select: '*, product:products(*), branch:branches(*)',
    order: { column: 'created_at', ascending: false },
    branch_id: branchFilter,
    pageSize: 100,
  });

  const [products, setProducts] = useState<Product[]>([]);
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [materialCosts, setMaterialCosts] = useState<Record<string, number>>({});
  const [branches, setBranches] = useState<Branch[]>([]);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Recipe | null>(null);
  const [form, setForm] = useState({ product_id: '', branch_id: '', name: '', yield_quantity: 1, notes: '', is_active: true });
  const [items, setItems] = useState<ItemForm[]>([{ ...EMPTY_ITEM }]);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const loadMeta = useCallback(async () => {
    setMetaError(null);
    let productQuery = supabase.from('products').select('*').eq('is_active', true);
    if (branchFilter) productQuery = productQuery.eq('branch_id', branchFilter);
    let branchQuery = supabase.from('branches').select('*').eq('is_active', true);
    if (branchFilter) branchQuery = branchQuery.eq('id', branchFilter);

    const [pr, br] = await Promise.all([productQuery.order('name'), branchQuery.order('name')]);
    if (pr.error || br.error) {
      setMetaError(pr.error?.message || br.error?.message || 'Failed to load recipe metadata');
      setProducts([]);
      setBranches([]);
      return;
    }
    setProducts((pr.data as Product[]) || []);
    setBranches((br.data as Branch[]) || []);
  }, [branchFilter]);

  const loadMaterialsForBranch = useCallback(async (branchId: string) => {
    if (!branchId) { setMaterials([]); setMaterialCosts({}); return; }
    const [materialsRes, inventoryRes] = await Promise.all([
      supabase.from('raw_materials').select('*').eq('is_active', true).eq('branch_id', branchId).order('name'),
      supabase.from('raw_material_inventory').select('raw_material_id,avg_cost').eq('branch_id', branchId),
    ]);
    if (materialsRes.error) {
      setMetaError(materialsRes.error.message);
      setMaterials([]);
      setMaterialCosts({});
      return;
    }
    const rows = (materialsRes.data as RawMaterial[]) || [];
    setMaterials(rows);
    const nextCosts: Record<string, number> = {};
    for (const row of (inventoryRes.data || []) as { raw_material_id: string; avg_cost: number }[]) {
      if (Number(row.avg_cost) > 0) nextCosts[row.raw_material_id] = Number(row.avg_cost);
    }
    for (const material of rows) {
      if (!(material.id in nextCosts)) nextCosts[material.id] = Number(material.default_cost || 0);
    }
    setMaterialCosts(nextCosts);
  }, []);

  useEffect(() => { void loadMeta(); }, [loadMeta]);
  useEffect(() => { void loadMaterialsForBranch(form.branch_id); }, [form.branch_id, loadMaterialsForBranch]);

  const filtered = recipes.filter((rc) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (rc.product?.name || '').toLowerCase().includes(q) || (rc.name || '').toLowerCase().includes(q);
  });

  const openAdd = () => {
    setEditing(null);
    const branchId = branchFilter || user?.branch_id || branches[0]?.id || '';
    setForm({ product_id: '', branch_id: branchId, name: '', yield_quantity: 1, notes: '', is_active: true });
    setItems([{ ...EMPTY_ITEM }]);
    setModalOpen(true);
  };

  const openEdit = async (rc: Recipe) => {
    const { data, error: itemError } = await supabase.from('recipe_items').select('*').eq('recipe_id', rc.id).order('created_at');
    if (itemError) { show(itemError.message, 'error'); return; }
    setEditing(rc);
    setForm({ product_id: rc.product_id, branch_id: rc.branch_id, name: rc.name || '', yield_quantity: Number(rc.yield_quantity) || 1, notes: rc.notes || '', is_active: rc.is_active });
    const fetched = ((data as RecipeItem[]) || []).map((it) => ({ raw_material_id: it.raw_material_id, quantity: Number(it.quantity), wastage_percent: Number(it.wastage_percent) }));
    setItems(fetched.length ? fetched : [{ ...EMPTY_ITEM }]);
    setModalOpen(true);
  };

  const addLine = () => setItems((current) => [...current, { ...EMPTY_ITEM }]);
  const updateLine = (index: number, field: keyof ItemForm, value: string | number) => setItems((current) => current.map((item, i) => i === index ? { ...item, [field]: value } : item));
  const removeLine = (index: number) => setItems((current) => current.filter((_, i) => i !== index));

  const save = async () => {
    if (!form.product_id || !form.branch_id) { show(t('required'), 'error'); return; }
    const validItems = items.filter((it) => it.raw_material_id && Number(it.quantity) > 0);
    if (validItems.length === 0) { show(t('required') + ': ' + t('recipeItems'), 'error'); return; }

    const payload = { product_id: form.product_id, branch_id: form.branch_id, name: form.name.trim() || null, yield_quantity: Number(form.yield_quantity) || 1, notes: form.notes.trim() || null, is_active: form.is_active };
    const itemRows: RecipeItemInput[] = validItems.map((it) => ({ raw_material_id: it.raw_material_id, quantity: Number(it.quantity), wastage_percent: Number(it.wastage_percent) || 0 }));

    let recipeId = editing?.id || '';
    if (editing) {
      const { data, error: rpcError } = await supabase.rpc('update_recipe_with_items', {
        p_recipe_id: editing.id,
        p_name: form.name.trim(),
        p_yield_quantity: Number(form.yield_quantity) || 1,
        p_notes: form.notes.trim(),
        p_is_active: form.is_active,
        p_items: itemRows,
      });
      const result = data as RecipeMutationResult | null;
      if (rpcError || !result?.success) {
        show(rpcError?.message || result?.detail || result?.error || t('error'), 'error');
        return;
      }
    } else {
      const { data, error: insertError } = await supabase.from('recipes').insert(payload).select().single();
      if (insertError || !data) { show(insertError?.message || t('error'), 'error'); return; }
      recipeId = (data as Recipe).id;
      const { error: itemsError } = await supabase.from('recipe_items').insert(itemRows.map((item) => ({ ...item, recipe_id: recipeId })));
      if (itemsError) { show(itemsError.message, 'error'); return; }
      await logAudit('create', 'recipes', recipeId);
    }

    show(t('saveSuccess'), 'success');
    setModalOpen(false);
    reloadRecipes();
  };

  const remove = async () => {
    if (!deleteId) return;
    const { data, error: deleteError } = await supabase.rpc('delete_recipe_controlled', { p_recipe_id: deleteId });
    const result = data as RecipeMutationResult | null;
    if (deleteError || !result?.success) show(deleteError?.message || result?.detail || result?.error || t('error'), 'error');
    else show(t('deleteSuccess'), 'success');
    setDeleteId(null);
    reloadRecipes();
  };

  const calculatedCost = useMemo(() => {
    const rawCost = items.reduce((sum, item) => {
      if (!item.raw_material_id || !Number(item.quantity)) return sum;
      const unitCost = Number(materialCosts[item.raw_material_id] || 0);
      return sum + unitCost * Number(item.quantity) * (1 + Number(item.wastage_percent || 0) / 100);
    }, 0);
    const yieldQty = Math.max(1, Number(form.yield_quantity || 1));
    const costPerUnit = rawCost / yieldQty;
    const selectedProduct = products.find((product) => product.id === form.product_id);
    const sellPrice = Number(selectedProduct?.sale_price || 0);
    const foodCostRatio = sellPrice > 0 ? (costPerUnit / sellPrice) * 100 : 0;
    const margin = sellPrice > 0 ? ((sellPrice - costPerUnit) / sellPrice) * 100 : 0;
    return { rawCost, costPerUnit, sellPrice, foodCostRatio, margin };
  }, [form.product_id, form.yield_quantity, items, materialCosts, products]);

  const columns: Column<Recipe>[] = [
    { key: 'product', header: t('product'), render: (rc) => <div className="flex items-center gap-2"><div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center"><ChefHat className="w-4 h-4 text-purple-600" /></div><div><p className="font-medium text-ui-text">{rc.product?.name || '-'}</p>{rc.name && <p className="text-xs text-ui-subtle">{rc.name}</p>}</div></div> },
    { key: 'branch', header: t('branch'), render: (rc) => rc.branch?.name || '-' },
    { key: 'yield', header: t('yieldQuantity'), render: (rc) => formatNumber(Number(rc.yield_quantity)) },
    { key: 'actions', header: t('actions'), render: (rc) => <div className="flex gap-1">{can('recipes.manage') && <button onClick={() => openEdit(rc)} className="p-1.5 text-ui-info"><Edit2 className="w-4 h-4" /></button>}{can('recipes.manage') && <button onClick={() => setDeleteId(rc.id)} className="p-1.5 text-ui-danger"><Trash2 className="w-4 h-4" /></button>}</div> },
  ];

  return (
    <DesignSurface testId="recipes-page">
      <DesignPageHeader title={t('recipes')} subtitle={isAr ? 'وصفات المنتجات النشطة في الفرع' : 'Recipes for active branch products'} actions={can('recipes.manage') ? <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4" /> {t('addRecipe')}</Button> : undefined} />
      <DesignPanel><DesignSearch value={search} onChange={setSearch} label={t('search')} placeholder={t('search')} /></DesignPanel>
      <DesignPanel>
        <DataTable columns={columns} data={filtered} loading={loading} error={error} emptyMessage={t('noData')} />
        <DesignPagination loaded={recipes.length} total={total} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} />
      </DesignPanel>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? t('editRecipe') : t('addRecipe')} size="2xl">
        <div className="space-y-5">
          {metaError && <div className="rounded-xl border border-ui-danger/20 bg-ui-danger-soft p-3 text-sm text-ui-danger">{metaError}</div>}
          {products.length === 0 && !metaError && (
            <div className="rounded-xl border border-ui-warning/20 bg-ui-warning-soft p-4 text-sm text-ui-warning flex gap-3"><Package className="h-5 w-5 shrink-0" /><span>{isAr ? 'لا توجد منتجات نشطة في هذا الفرع. أنشئ منتجاً أولاً ثم أضف الوصفة.' : 'No active products exist in this branch. Create a product before adding a recipe.'}</span></div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select label={t('product')} value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })} disabled={!!editing || products.length === 0}>
              <option value="" disabled>{t('selectProduct')}</option>
              {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
            </Select>
            <Select label={t('branch')} value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })} disabled={!!branchFilter || !!editing}>
              <option value="" disabled>{t('branch')}</option>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </Select>
            <Input label={t('name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input label={t('yieldQuantity')} type="number" min="0.0001" step="0.0001" value={form.yield_quantity} onChange={(e) => setForm({ ...form, yield_quantity: parseFloat(e.target.value) || 1 })} />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2"><p className="text-sm font-bold text-ui-muted">{t('recipeItems')}</p><Button variant="outline" size="sm" onClick={addLine}><Plus className="w-4 h-4" /> {t('add')}</Button></div>
            {materials.length === 0 && form.branch_id ? <p className="rounded-lg bg-ui-page-alt p-3 text-sm text-ui-muted">{isAr ? 'لا توجد خامات نشطة في هذا الفرع.' : 'No active raw materials in this branch.'}</p> : null}
            <div className="space-y-2">
              {items.map((item, index) => (
                <div key={index} className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_120px_120px_40px] gap-2 items-end">
                  <Select value={item.raw_material_id} onChange={(e) => updateLine(index, 'raw_material_id', e.target.value)}><option value="" disabled>{t('selectRawMaterial')}</option>{materials.map((material) => <option key={material.id} value={material.id}>{material.name}</option>)}</Select>
                  <Input type="number" min="0.0001" step="0.0001" value={item.quantity} onChange={(e) => updateLine(index, 'quantity', parseFloat(e.target.value) || 0)} />
                  <Input type="number" min="0" step="0.01" value={item.wastage_percent} onChange={(e) => updateLine(index, 'wastage_percent', parseFloat(e.target.value) || 0)} />
                  <button onClick={() => removeLine(index)} className="p-2 rounded-lg text-ui-danger hover:bg-ui-danger-soft"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl p-4 border border-ui-border bg-ui-surface shadow-sm">
            <div className="flex items-center gap-2 mb-3"><div className="p-1.5 rounded-lg bg-ui-primary-soft text-ui-primary"><Calculator className="w-4 h-4" /></div><p className="text-sm font-bold text-ui-text">{isAr ? 'التحليل المالي المباشر للوصفة (Live Costing)' : 'Live Recipe Costing & Profitability'}</p></div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-center">
              <div className="rounded-lg border border-ui-border p-3"><p className="text-xs text-ui-subtle">{isAr ? 'إجمالي تكلفة المواد' : 'Material cost'}</p><p className="font-bold">{formatCurrency(calculatedCost.rawCost, 'EGP', lang)}</p></div>
              <div className="rounded-lg border border-ui-border p-3"><p className="text-xs text-ui-subtle">{isAr ? 'تكلفة الوحدة الواحدة' : 'Unit cost'}</p><p className="font-bold text-ui-primary">{formatCurrency(calculatedCost.costPerUnit, 'EGP', lang)}</p></div>
              <div className="rounded-lg border border-ui-border p-3"><p className="text-xs text-ui-subtle">{isAr ? 'نسبة تكلفة الطعام' : 'Food cost %'}</p><p className="font-bold">{calculatedCost.sellPrice > 0 ? `${formatNumber(calculatedCost.foodCostRatio, 1)}%` : '-'}</p></div>
              <div className="rounded-lg border border-ui-border p-3"><p className="text-xs text-ui-subtle">{isAr ? 'هامش الربح المتوقع' : 'Expected margin'}</p><p className="font-bold">{calculatedCost.sellPrice > 0 ? `${formatNumber(calculatedCost.margin, 1)}%` : '-'}</p></div>
            </div>
          </div>

          <div className="sticky bottom-0 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-ui-surface/95 backdrop-blur border-t border-ui-border flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>{t('cancel')}</Button>
            <Button onClick={save} disabled={products.length === 0}>{t('save')}</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={remove} title={t('delete')} message={t('confirmDelete')} confirmLabel={t('delete')} cancelLabel={t('cancel')} />
    </DesignSurface>
  );
}
