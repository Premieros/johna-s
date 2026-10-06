import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Edit2, Trash2, ChefHat, Calculator, Package } from 'lucide-react';
import * as api from '@/api';
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
import { formatCurrency, formatNumber, formatRawMaterialQuantity, measurementUnitLabel } from '@/lib/format';
import { logAudit } from '@/lib/audit';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import type { Recipe, RecipeItem, RawMaterial, Product, Branch, RecipeItemInput, Unit } from '@/lib/types';
import { createRecipeWithItems, deleteRecipeControlled, loadRecipeComponents, loadRecipeItems, loadRecipeManufacturedLinks, loadRecipeMeta, updateRecipeWithItems, type RecipeManufacturedUnitOption as ManufacturedUnitOption, type RecipeMutationResult } from '../services/recipeData';

interface ItemForm {
  raw_material_id: string;
  quantity: number;
  wastage_percent: number;
}

interface ManufacturedComponentForm {
  unit_id: string;
  quantity: number;
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
  const [manufacturedUnits, setManufacturedUnits] = useState<ManufacturedUnitOption[]>([]);
  const [manufacturedItems, setManufacturedItems] = useState<ManufacturedComponentForm[]>([]);
  const [manufacturedUnitSel, setManufacturedUnitSel] = useState('');
  const [manufacturedUnitQty, setManufacturedUnitQty] = useState(1);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Recipe | null>(null);
  const [form, setForm] = useState({ product_id: '', branch_id: '', name: '', yield_quantity: 1, notes: '', is_active: true });
  const [items, setItems] = useState<ItemForm[]>([{ ...EMPTY_ITEM }]);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const loadMeta = useCallback(async () => {
    setMetaError(null);
    try {
      const data = await loadRecipeMeta(branchFilter);
      setProducts(data.products);
      setBranches(data.branches);
      setUnits(data.units);
    } catch (error) {
      setMetaError(error instanceof Error ? error.message : 'Failed to load recipe metadata');
      setProducts([]);
      setBranches([]);
      setUnits([]);
    }
  }, [branchFilter]);

  const loadMaterialsForBranch = useCallback(async (branchId: string) => {
    if (!branchId) {
      setMaterials([]);
      setMaterialCosts({});
      setManufacturedUnits([]);
      return;
    }
    try {
      const data = await loadRecipeComponents(branchId);
      setMaterials(data.materials);
      setMaterialCosts(data.materialCosts);
      setManufacturedUnits(data.manufacturedUnits);
    } catch (error) {
      setMetaError(error instanceof Error ? error.message : 'Failed to load recipe components');
      setMaterials([]);
      setMaterialCosts({});
      setManufacturedUnits([]);
    }
  }, []);

  useEffect(() => { void loadMeta(); }, [loadMeta]);
  useEffect(() => { void loadMaterialsForBranch(form.branch_id); }, [form.branch_id, loadMaterialsForBranch]);

  useEffect(() => {
    if (!modalOpen || !form.product_id) {
      setManufacturedItems([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const data = await loadRecipeManufacturedLinks(form.product_id);
        if (cancelled) return;
        setManufacturedItems(data);
      } catch (error) {
        if (cancelled) return;
        setMetaError(error instanceof Error ? error.message : String(error));
        setManufacturedItems([]);
      }
    })();
    return () => { cancelled = true; };
  }, [modalOpen, form.product_id]);

  const unitForMaterial = (materialId: string) => {
    const material = materials.find((row) => row.id === materialId);
    return material?.unit_id ? units.find((unit) => unit.id === material.unit_id) : undefined;
  };
  const unitLabelForMaterial = (materialId: string) => {
    const unit = unitForMaterial(materialId);
    return unit ? (measurementUnitLabel(unit) || unit.name) : '';
  };

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
    setManufacturedItems([]);
    setManufacturedUnitSel('');
    setManufacturedUnitQty(1);
    setModalOpen(true);
  };

  const openEdit = async (rc: Recipe) => {
    let recipeItems: RecipeItem[];
    try {
      recipeItems = await loadRecipeItems(rc.id);
    } catch (error) {
      show(error instanceof Error ? error.message : String(error), 'error');
      return;
    }
    setEditing(rc);
    setForm({ product_id: rc.product_id, branch_id: rc.branch_id, name: rc.name || '', yield_quantity: Number(rc.yield_quantity) || 1, notes: rc.notes || '', is_active: rc.is_active });
    const fetched = recipeItems.map((it) => ({ raw_material_id: it.raw_material_id, quantity: Number(it.quantity), wastage_percent: Number(it.wastage_percent) }));
    setItems(fetched.length ? fetched : [{ ...EMPTY_ITEM }]);
    setManufacturedUnitSel('');
    setManufacturedUnitQty(1);
    setModalOpen(true);
  };

  const addLine = () => setItems((current) => [...current, { ...EMPTY_ITEM }]);
  const updateLine = (index: number, field: keyof ItemForm, value: string | number) => setItems((current) => current.map((item, i) => i === index ? { ...item, [field]: value } : item));
  const removeLine = (index: number) => setItems((current) => current.filter((_, i) => i !== index));

  const availableManufacturedUnits = manufacturedUnits.filter(
    (unit) => !manufacturedItems.some((item) => item.unit_id === unit.id),
  );
  const addManufacturedLine = () => {
    if (!manufacturedUnitSel) return;
    setManufacturedItems((current) => [
      ...current,
      { unit_id: manufacturedUnitSel, quantity: manufacturedUnitQty > 0 ? manufacturedUnitQty : 1 },
    ]);
    setManufacturedUnitSel('');
    setManufacturedUnitQty(1);
  };
  const updateManufacturedQty = (index: number, quantity: number) => {
    setManufacturedItems((current) => current.map((item, i) => i === index
      ? { ...item, quantity: quantity > 0 ? quantity : 1 }
      : item));
  };
  const removeManufacturedLine = (index: number) => {
    setManufacturedItems((current) => current.filter((_, i) => i !== index));
  };

  const save = async () => {
    if (!form.product_id || !form.branch_id) { show(t('required'), 'error'); return; }
    const validItems = items.filter((it) => it.raw_material_id && Number(it.quantity) > 0);
    const validManufacturedItems = manufacturedItems.filter((it) => it.unit_id && Number(it.quantity) > 0);
    if (validItems.length === 0 && validManufacturedItems.length === 0) {
      show(t('required') + ': ' + t('recipeItems'), 'error');
      return;
    }

    const payload = { product_id: form.product_id, branch_id: form.branch_id, name: form.name.trim() || null, yield_quantity: Number(form.yield_quantity) || 1, notes: form.notes.trim() || null, is_active: form.is_active };
    const itemRows: RecipeItemInput[] = validItems.map((it) => ({ raw_material_id: it.raw_material_id, quantity: Number(it.quantity), wastage_percent: Number(it.wastage_percent) || 0 }));

    let recipeId = editing?.id || '';
    if (editing) {
      let result: RecipeMutationResult;
      try {
        result = await updateRecipeWithItems({
          recipeId: editing.id,
          name: form.name.trim(),
          yieldQuantity: Number(form.yield_quantity) || 1,
          notes: form.notes.trim(),
          isActive: form.is_active,
          items: itemRows,
        });
      } catch (error) {
        show(error instanceof Error ? error.message : String(error), 'error');
        return;
      }
      if (!result?.success) {
        show(result?.detail || result?.error || t('error'), 'error');
        return;
      }
    } else {
      try {
        recipeId = await createRecipeWithItems({ payload, items: itemRows });
      } catch (error) {
        show(error instanceof Error ? error.message : t('error'), 'error');
        return;
      }
      await logAudit('create', 'recipes', recipeId);
    }

    try {
      await api.catalog.setProductUnitLinks(
        form.product_id,
        validManufacturedItems.map((item) => ({ unit_id: item.unit_id, quantity: Number(item.quantity) })),
      );
    } catch (linkError) {
      show(linkError instanceof Error ? linkError.message : String(linkError), 'error');
      return;
    }

    show(t('saveSuccess'), 'success');
    setModalOpen(false);
    reloadRecipes();
  };

  const remove = async () => {
    if (!deleteId) return;
    try {
      const result = await deleteRecipeControlled(deleteId);
      if (!result?.success) show(result?.detail || result?.error || t('error'), 'error');
      else show(t('deleteSuccess'), 'success');
    } catch (error) {
      show(error instanceof Error ? error.message : String(error), 'error');
    }
    setDeleteId(null);
    reloadRecipes();
  };

  const calculatedCost = useMemo(() => {
    const rawCost = items.reduce((sum, item) => {
      if (!item.raw_material_id || !Number(item.quantity)) return sum;
      const unitCost = Number(materialCosts[item.raw_material_id] || 0);
      return sum + unitCost * Number(item.quantity) * (1 + Number(item.wastage_percent || 0) / 100);
    }, 0);
    const manufacturedCost = manufacturedItems.reduce((sum, item) => {
      const unit = manufacturedUnits.find((row) => row.id === item.unit_id);
      return sum + Number(unit?.cost_price || 0) * Number(item.quantity || 0);
    }, 0);
    const totalComponentCost = rawCost + manufacturedCost;
    const yieldQty = Math.max(1, Number(form.yield_quantity || 1));
    const costPerUnit = totalComponentCost / yieldQty;
    const selectedProduct = products.find((product) => product.id === form.product_id);
    const sellPrice = Number(selectedProduct?.sale_price || 0);
    const foodCostRatio = sellPrice > 0 ? (costPerUnit / sellPrice) * 100 : 0;
    const margin = sellPrice > 0 ? ((sellPrice - costPerUnit) / sellPrice) * 100 : 0;
    const unpriced = items.some((item) => item.raw_material_id && Number(item.quantity) > 0 && !(materialCosts[item.raw_material_id] > 0));
    return { rawCost: totalComponentCost, costPerUnit, sellPrice, foodCostRatio, margin, unpriced };
  }, [form.product_id, form.yield_quantity, items, manufacturedItems, manufacturedUnits, materialCosts, products]);

  const columns: Column<Recipe>[] = [
    { key: 'product', header: t('product'), render: (rc) => <div className="flex items-center gap-2"><div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center"><ChefHat className="w-4 h-4 text-purple-600" /></div><div><p className="font-medium text-ui-text">{rc.product?.name || '-'}</p>{rc.name && <p className="text-xs text-ui-subtle">{rc.name}</p>}</div></div> },
    { key: 'branch', header: t('branch'), render: (rc) => rc.branch?.name || '-' },
    { key: 'yield', header: t('yieldQuantity'), render: (rc) => formatNumber(Number(rc.yield_quantity)) },
    { key: 'actions', header: t('actions'), render: (rc) => <div className="flex gap-1">{can('recipes.manage') && <button onClick={() => openEdit(rc)} className="p-1.5 text-ui-info"><Edit2 className="w-4 h-4" /></button>}{can('recipes.manage') && <button onClick={() => setDeleteId(rc.id)} className="p-1.5 text-ui-danger"><Trash2 className="w-4 h-4" /></button>}</div> },
  ];

  return (
    <DesignSurface testId="recipes-page">
      <DesignPageHeader title={t('recipes')} subtitle={isAr ? 'تعريف الخامات ومجموعات المكونات المرتبطة بكل منتج' : 'Define raw materials and component groups linked to each product'} actions={can('recipes.manage') ? <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4" /> {t('addRecipe')}</Button> : undefined} />
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
              {items.map((item, index) => {
                const selectedUnit = unitForMaterial(item.raw_material_id);
                const selectedUnitLabel = unitLabelForMaterial(item.raw_material_id);
                return (
                  <div key={index} className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_160px_120px_40px] gap-2 items-end">
                    <Select value={item.raw_material_id} onChange={(e) => updateLine(index, 'raw_material_id', e.target.value)}>
                      <option value="" disabled>{t('selectRawMaterial')}</option>
                      {materials.map((material) => {
                        const unit = material.unit_id ? units.find((row) => row.id === material.unit_id) : undefined;
                        const label = unit ? (measurementUnitLabel(unit) || unit.name) : '';
                        return <option key={material.id} value={material.id}>{material.name}{label ? ` — ${label}` : ''}</option>;
                      })}
                    </Select>
                    <div>
                      <Input label={selectedUnitLabel ? `${t('quantity')} (${selectedUnitLabel})` : t('quantity')} type="number" min="0.0001" step="0.0001" value={item.quantity} onChange={(e) => updateLine(index, 'quantity', parseFloat(e.target.value) || 0)} />
                      {item.raw_material_id && Number(item.quantity) > 0 && (
                        <p className="mt-1 text-xs font-semibold text-ui-primary" data-testid={`recipe-item-display-quantity-${index}`}>
                          {formatRawMaterialQuantity(item.quantity, selectedUnit, { preferGrams: true, lang })}
                        </p>
                      )}
                    </div>
                    <Input label={isAr ? 'هالك %' : 'Waste %'} type="number" min="0" step="0.01" value={item.wastage_percent} onChange={(e) => updateLine(index, 'wastage_percent', parseFloat(e.target.value) || 0)} />
                    <button onClick={() => removeLine(index)} className="p-2 rounded-lg text-ui-danger hover:bg-ui-danger-soft"><Trash2 className="w-4 h-4" /></button>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-bold text-ui-muted">{isAr ? 'مجموعات المكونات داخل الوصفة' : 'Component groups in recipe'}</p>
              <span className="text-xs text-ui-subtle">{manufacturedItems.length}</span>
            </div>
            <div className="space-y-2">
              {manufacturedItems.map((item, index) => {
                const unit = manufacturedUnits.find((row) => row.id === item.unit_id);
                return (
                  <div key={item.unit_id} className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_160px_40px] gap-2 items-end rounded-lg border border-ui-border bg-ui-page-alt p-2">
                    <div>
                      <p className="text-sm font-medium text-ui-text">{unit?.name || item.unit_id}</p>
                      <p className="text-xs text-ui-subtle">{isAr ? 'مجموعة مكونات' : 'Component group'}</p>
                    </div>
                    <Input label={t('quantity')} type="number" min="0.0001" step="0.0001" value={item.quantity} onChange={(e) => updateManufacturedQty(index, parseFloat(e.target.value) || 1)} />
                    <button type="button" onClick={() => removeManufacturedLine(index)} className="p-2 rounded-lg text-ui-danger hover:bg-ui-danger-soft"><Trash2 className="w-4 h-4" /></button>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_160px_auto] gap-2 items-end">
              <Select label={isAr ? 'إضافة مجموعة مكونات' : 'Add component group'} value={manufacturedUnitSel} onChange={(e) => setManufacturedUnitSel(e.target.value)}>
                <option value="">--</option>
                {availableManufacturedUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
              </Select>
              <Input label={t('quantity')} type="number" min="0.0001" step="0.0001" value={manufacturedUnitQty} onChange={(e) => setManufacturedUnitQty(parseFloat(e.target.value) || 1)} />
              <Button type="button" variant="outline" size="sm" onClick={addManufacturedLine} disabled={!manufacturedUnitSel}><Plus className="w-4 h-4" /> {t('add')}</Button>
            </div>
          </div>

          <div className="rounded-xl p-4 border border-ui-border bg-ui-surface shadow-sm">
            <div className="flex items-center gap-2 mb-3"><div className="p-1.5 rounded-lg bg-ui-primary-soft text-ui-primary"><Calculator className="w-4 h-4" /></div><p className="text-sm font-bold text-ui-text">{isAr ? 'التحليل المالي المباشر للوصفة (Live Costing)' : 'Live Recipe Costing & Profitability'}</p></div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-center">
              {calculatedCost.unpriced && <p role="status" className="text-sm text-ui-warning sm:col-span-2">{isAr ? 'التكلفة غير مكتملة: توجد خامات بلا تكلفة FIFO متاحة.' : 'Incomplete cost: some raw materials have no available FIFO cost.'}</p>}
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