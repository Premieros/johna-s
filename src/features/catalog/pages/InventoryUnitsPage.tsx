import { useState } from 'react';
import { Plus, Edit2, Trash2, Beaker } from 'lucide-react';
import { supabase } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { DesignSurface, DesignPageHeader } from '@/components/design/DesignSurface';
import { DesignPanel } from '@/components/design/DesignPanel';
import { DesignPagination } from '@/components/design/DesignPagination';
import { DataTable, type Column } from '@/components/DataTable';
import { Button } from '@/components/Button';
import { Input, Textarea } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { logAudit } from '@/lib/audit';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useCan } from '@/lib/permissions';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import type { InventoryUnit } from '@/lib/types';

interface UnitForm {
  code: string;
  name: string;
  name_en: string;
  unit_type: 'ready' | 'manufactured';
  cost_price: number;
  sale_price: number;
  min_stock: number;
  max_stock: number;
  reorder_point: number;
  low_stock_threshold: number;
  barcode: string;
  sku: string;
  description: string;
}
interface RecipeRow { id?: string; raw_material_id: string; quantity: number; wastage_percent: number; }
interface RawMaterialOption { id: string; name: string; }

const EMPTY_FORM: UnitForm = {
  code: '', name: '', name_en: '', unit_type: 'manufactured', cost_price: 0, sale_price: 0,
  min_stock: 0, max_stock: 0, reorder_point: 0, low_stock_threshold: 5,
  barcode: '', sku: '', description: '',
};
const EMPTY_RECIPE_ROW = (): RecipeRow => ({ raw_material_id: '', quantity: 1, wastage_percent: 0 });
const cleanUserDescription = (description?: string | null) => {
  const value = (description || '').trim();
  return /^Manufactured component migrated from product\b/i.test(value) ? '' : value;
};

export function InventoryUnitsPage() {
  const { t, lang } = useLanguage();
  const { show } = useToast();
  const can = useCan();
  const branchFilter = useBranchFilter();
  const isAr = lang === 'ar';
  const { rows: items, loading, total, hasMore, loadMore, loadingMore, refresh: reloadItems } = usePaginatedRows<InventoryUnit>({
    table: 'inventory_units', select: '*', order: { column: 'name', ascending: true }, branch_id: branchFilter,
    filters: [{ column: 'unit_type', value: 'manufactured' }], pageSize: 100,
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<InventoryUnit | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState<UnitForm>(EMPTY_FORM);
  const [recipeModalOpen, setRecipeModalOpen] = useState(false);
  const [recipeUnit, setRecipeUnit] = useState<InventoryUnit | null>(null);
  const [recipeRows, setRecipeRows] = useState<RecipeRow[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawMaterialOption[]>([]);
  const [recipeLoading, setRecipeLoading] = useState(false);

  const openAdd = () => { setEditing(null); setForm({ ...EMPTY_FORM }); setModalOpen(true); };
  const openEdit = (unit: InventoryUnit) => {
    setEditing(unit);
    setForm({
      code: unit.code, name: unit.name, name_en: unit.name_en || '', unit_type: unit.unit_type,
      cost_price: unit.cost_price, sale_price: unit.sale_price, min_stock: unit.min_stock,
      max_stock: unit.max_stock, reorder_point: unit.reorder_point,
      low_stock_threshold: unit.low_stock_threshold, barcode: unit.barcode || '', sku: unit.sku || '',
      description: cleanUserDescription(unit.description),
    });
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.code || !form.name) { show(t('required'), 'error'); return; }
    const payload = {
      code: form.code,
      name: form.name,
      name_en: form.name_en || null,
      cost_price: Number(form.cost_price), sale_price: Number(form.sale_price), min_stock: Number(form.min_stock),
      max_stock: Number(form.max_stock), reorder_point: Number(form.reorder_point), low_stock_threshold: Number(form.low_stock_threshold),
      barcode: form.barcode || null, sku: form.sku || null, description: form.description.trim() || null,
      branch_id: branchFilter || null,
    };
    if (editing) {
      const { error } = await supabase.from('inventory_units').update(payload).eq('id', editing.id);
      if (error) { show(error.message, 'error'); return; }
      await logAudit('update', 'inventory_units', editing.id);
    } else {
      const { error } = await supabase.from('inventory_units').insert({ ...payload, unit_type: 'manufactured' as const });
      if (error) { show(error.message, 'error'); return; }
      await logAudit('create', 'inventory_units');
    }
    show(t('saveSuccess'), 'success');
    setModalOpen(false);
    reloadItems();
  };

  const openRecipe = async (unit: InventoryUnit) => {
    if (unit.unit_type !== 'manufactured' || !can('production.manage')) return;
    setRecipeUnit(unit);
    setRecipeModalOpen(true);
    setRecipeLoading(true);
    let rawMaterialQuery = supabase.from('raw_materials').select('id,name').eq('is_active', true);
    if (branchFilter) rawMaterialQuery = rawMaterialQuery.eq('branch_id', branchFilter);
    const [{ data: rawData, error: rawError }, { data: recipeData, error: recipeError }] = await Promise.all([
      rawMaterialQuery.order('name'),
      supabase.from('inventory_unit_recipes').select('id,raw_material_id,quantity,wastage_percent').eq('unit_id', unit.id).order('created_at'),
    ]);
    if (rawError) show(rawError.message, 'error');
    if (recipeError) show(recipeError.message, 'error');
    setRawMaterials((rawData as RawMaterialOption[]) || []);
    setRecipeRows((recipeData as RecipeRow[]) || []);
    setRecipeLoading(false);
  };

  const saveRecipe = async () => {
    if (!recipeUnit || recipeUnit.unit_type !== 'manufactured') return;
    const valid = recipeRows.every((row) => row.raw_material_id && Number(row.quantity) > 0 && Number(row.wastage_percent) >= 0);
    if (!valid) { show(isAr ? 'أكمل بيانات الوصفة' : 'Complete the recipe rows', 'error'); return; }
    setRecipeLoading(true);
    const { error: deleteError } = await supabase.from('inventory_unit_recipes').delete().eq('unit_id', recipeUnit.id);
    if (deleteError) { show(deleteError.message, 'error'); setRecipeLoading(false); return; }
    if (recipeRows.length) {
      const { error: insertError } = await supabase.from('inventory_unit_recipes').insert(recipeRows.map((row) => ({
        unit_id: recipeUnit.id, raw_material_id: row.raw_material_id, quantity: Number(row.quantity), wastage_percent: Number(row.wastage_percent) || 0,
      })));
      if (insertError) { show(insertError.message, 'error'); setRecipeLoading(false); return; }
    }
    await logAudit('update', 'inventory_unit_recipes', recipeUnit.id, { unit_name: recipeUnit.name, ingredient_count: recipeRows.length });
    show(t('saveSuccess'), 'success');
    setRecipeLoading(false);
    setRecipeModalOpen(false);
  };

  const remove = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from('inventory_units').delete().eq('id', deleteId);
    if (error) show(error.message, 'error');
    else { show(t('deleteSuccess'), 'success'); await logAudit('delete', 'inventory_units', deleteId); }
    setDeleteId(null);
    reloadItems();
  };

  const columns: Column<InventoryUnit>[] = [
    { key: 'code', header: t('code'), render: (unit) => <span className="font-mono text-sm">{unit.code}</span> },
    { key: 'name', header: isAr ? 'اسم المصنع' : 'Manufactured item', render: (unit) => <span className="font-medium text-ui-text">{unit.name}</span> },
    { key: 'cost_price', header: t('costPrice'), render: (unit) => <span className="text-sm">{Number(unit.cost_price).toFixed(2)}</span> },
    { key: 'sale_price', header: t('salePrice'), render: (unit) => <span className="text-sm">{Number(unit.sale_price).toFixed(2)}</span> },
    { key: 'actions', header: t('actions'), render: (unit) => <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
      {unit.unit_type === 'manufactured' && can('production.manage') && <button onClick={() => openRecipe(unit)} className="p-1.5 rounded-md hover:bg-purple-50 text-purple-500" title={isAr ? 'وصفة المصنع' : 'Manufactured item recipe'}><Beaker className="w-4 h-4" /></button>}
      {can('raw_materials.manage') && <button onClick={() => openEdit(unit)} className="p-1.5 rounded-md hover:bg-ui-info-soft text-ui-info"><Edit2 className="w-4 h-4" /></button>}
      {can('raw_materials.manage') && <button onClick={() => setDeleteId(unit.id)} className="p-1.5 rounded-md hover:bg-ui-danger-soft text-ui-danger"><Trash2 className="w-4 h-4" /></button>}
    </div> },
  ];

  const fieldGrid = 'grid grid-cols-1 sm:grid-cols-2 gap-4';

  return (
    <DesignSurface testId="inventory-units-page">
      <DesignPageHeader
        title={isAr ? 'المصنعات' : 'Manufactured Items'}
        subtitle={isAr ? 'مكونات يتم تصنيعها من الخامات وتستخدم داخل المنتجات' : 'Components manufactured from raw materials and used inside products'}
        actions={can('raw_materials.manage') ? <Button size="sm" onClick={openAdd} data-testid="inventory-units-add"><Plus className="w-4 h-4" /> {isAr ? 'إضافة مصنع' : 'Add manufactured item'}</Button> : undefined}
      />
      <DesignPanel testId="inventory-units-table-panel">
        <DataTable columns={columns} data={items} loading={loading} emptyMessage={t('noData')} onRowClick={can('raw_materials.manage') ? openEdit : undefined} />
        <DesignPagination loaded={items.length} total={total} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} />
      </DesignPanel>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? (isAr ? 'تعديل مصنع' : 'Edit manufactured item') : (isAr ? 'إضافة مصنع' : 'Add manufactured item')} size="lg">
        <div className="space-y-4">
          <div className={fieldGrid}><Input label={t('code')} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required /><Input label={isAr ? 'اسم المصنع' : 'Manufactured item name'} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
          <div className={fieldGrid}><Input label={t('nameEn')} value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} /><div><label className="block text-sm font-medium text-ui-muted mb-1">{isAr ? 'النوع' : 'Type'}</label><div className="min-h-11 flex items-center rounded-lg border border-ui-border bg-ui-page-alt px-3 text-sm font-semibold text-ui-text">{isAr ? 'مصنع' : 'Manufactured'}</div></div></div>
          <div className={fieldGrid}><Input label={t('costPrice')} type="number" min="0" step="0.01" value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: Number(e.target.value) || 0 })} /><Input label={t('salePrice')} type="number" min="0" step="0.01" value={form.sale_price} onChange={(e) => setForm({ ...form, sale_price: Number(e.target.value) || 0 })} /></div>
          <div className={fieldGrid}><Input label={t('minStock')} type="number" min="0" value={form.min_stock} onChange={(e) => setForm({ ...form, min_stock: Number(e.target.value) || 0 })} /><Input label={t('maxStock')} type="number" min="0" value={form.max_stock} onChange={(e) => setForm({ ...form, max_stock: Number(e.target.value) || 0 })} /></div>
          <div className={fieldGrid}><Input label={t('reorderPoint')} type="number" min="0" value={form.reorder_point} onChange={(e) => setForm({ ...form, reorder_point: Number(e.target.value) || 0 })} /><Input label={t('lowStockThreshold')} type="number" min="0" value={form.low_stock_threshold} onChange={(e) => setForm({ ...form, low_stock_threshold: Number(e.target.value) || 0 })} /></div>
          <div className={fieldGrid}><Input label={t('barcode')} value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} /><Input label={t('sku')} value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></div>
          <Textarea label={t('description')} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
          <div className="sticky bottom-0 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-ui-surface/95 backdrop-blur border-t border-ui-border flex justify-end gap-2"><Button variant="secondary" onClick={() => setModalOpen(false)}>{t('cancel')}</Button><Button onClick={save}>{t('save')}</Button></div>
        </div>
      </Modal>

      <Modal open={recipeModalOpen} onClose={() => setRecipeModalOpen(false)} title={recipeUnit ? `${isAr ? 'وصفة المصنع' : 'Manufactured item recipe'} — ${recipeUnit.name}` : (isAr ? 'وصفة المصنع' : 'Manufactured item recipe')} size="lg">
        <div className="space-y-4">
          <div className="rounded-lg bg-purple-50 border border-purple-200 p-3 text-sm text-purple-800">{isAr ? 'الخامات هنا تخص تصنيع هذا المصنع فقط. البيع لا يخصم خاماته مباشرة.' : 'These raw materials are consumed only when manufacturing this item. Sales do not deduct them directly.'}</div>
          {recipeRows.map((row, index) => <div key={index} className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_140px_140px_auto] gap-2 items-end p-3 rounded-lg border border-ui-border">
            <select aria-label={isAr ? 'الخامة' : 'Raw material'} value={row.raw_material_id} onChange={(e) => setRecipeRows((rows) => rows.map((item, i) => i === index ? { ...item, raw_material_id: e.target.value } : item))} className="min-h-11 rounded-lg border border-ui-border bg-ui-surface px-3 text-sm"><option value="" disabled>--</option>{rawMaterials.map((material) => <option key={material.id} value={material.id}>{material.name}</option>)}</select>
            <Input label={isAr ? 'الكمية' : 'Quantity'} type="number" min="0.0001" step="0.0001" value={row.quantity} onChange={(e) => setRecipeRows((rows) => rows.map((item, i) => i === index ? { ...item, quantity: Number(e.target.value) || 0 } : item))} />
            <Input label={isAr ? 'الهالك %' : 'Wastage %'} type="number" min="0" step="0.01" value={row.wastage_percent} onChange={(e) => setRecipeRows((rows) => rows.map((item, i) => i === index ? { ...item, wastage_percent: Number(e.target.value) || 0 } : item))} />
            <Button variant="outline" size="sm" onClick={() => setRecipeRows((rows) => rows.filter((_, i) => i !== index))}><Trash2 className="w-4 h-4" /></Button>
          </div>)}
          <Button variant="outline" onClick={() => setRecipeRows((rows) => [...rows, EMPTY_RECIPE_ROW()])}><Plus className="w-4 h-4" />{isAr ? 'إضافة خامة' : 'Add material'}</Button>
          <div className="sticky bottom-0 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-ui-surface/95 backdrop-blur border-t border-ui-border flex justify-end gap-2"><Button variant="secondary" onClick={() => setRecipeModalOpen(false)}>{t('cancel')}</Button><Button disabled={recipeLoading} onClick={saveRecipe}>{t('save')}</Button></div>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={remove} title={t('delete')} message={t('confirmDelete')} confirmLabel={t('delete')} cancelLabel={t('cancel')} />
    </DesignSurface>
  );
}
