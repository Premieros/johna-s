import { useState } from 'react';
import { Plus, Edit2, Trash2, Beaker } from 'lucide-react';
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
import { formatNumber } from '@/lib/format';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useCan } from '@/lib/permissions';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import type { InventoryUnit } from '@/lib/types';
import { deleteComponentGroup, loadInventoryUnitComponents, saveInventoryUnit, saveInventoryUnitComponents } from '../services/inventoryUnitData';

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
interface ComponentRow { id?: string; raw_material_id: string; quantity: number; wastage_percent: number; }
interface MeasurementUnitOption { id: string; name: string; symbol?: string | null; code?: string | null; }
interface RawMaterialOption {
  id: string;
  name: string;
  branch_id: string | null;
  unit_id: string | null;
  measurement_unit?: MeasurementUnitOption | null;
}

const EMPTY_FORM: UnitForm = {
  code: '', name: '', name_en: '', unit_type: 'manufactured', cost_price: 0, sale_price: 0,
  min_stock: 0, max_stock: 0, reorder_point: 0, low_stock_threshold: 5,
  barcode: '', sku: '', description: '',
};
const EMPTY_COMPONENT_ROW = (): ComponentRow => ({ raw_material_id: '', quantity: 1, wastage_percent: 0 });
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
  const [componentModalOpen, setRecipeModalOpen] = useState(false);
  const [componentUnit, setRecipeUnit] = useState<InventoryUnit | null>(null);
  const [componentRows, setComponentRows] = useState<ComponentRow[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawMaterialOption[]>([]);
  const [componentLoading, setRecipeLoading] = useState(false);

  const unitLabel = (material?: RawMaterialOption) => {
    const unit = material?.measurement_unit;
    if (!unit) return isAr ? 'وحدة غير محددة' : 'Unit not set';
    const short = unit.symbol || unit.code;
    return short && short !== unit.name ? `${unit.name} (${short})` : unit.name;
  };
  const materialLabel = (material: RawMaterialOption) => `${material.name} — ${unitLabel(material)}`;

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
    try {
      await saveInventoryUnit({ id: editing?.id, payload });
    } catch (error) {
      show(error instanceof Error ? error.message : String(error), 'error');
      return;
    }
    if (editing) await logAudit('update', 'inventory_units', editing.id);
    else await logAudit('create', 'inventory_units');
    show(t('saveSuccess'), 'success');
    setModalOpen(false);
    reloadItems();
  };

  const openComponents = async (unit: InventoryUnit) => {
    if (unit.unit_type !== 'manufactured' || !can('raw_materials.manage')) return;
    setRecipeUnit(unit);
    setRecipeModalOpen(true);
    setRecipeLoading(true);
    const componentBranchId = unit.branch_id || branchFilter || '';
    const data = await loadInventoryUnitComponents({ unitId: unit.id, branchId: componentBranchId });
    data.errors.forEach((message) => show(message, 'error'));
    setRawMaterials(data.rawMaterials);
    setComponentRows(data.components);
    setRecipeLoading(false);
  };

  const saveComponents = async () => {
    if (!componentUnit || componentUnit.unit_type !== 'manufactured') return;
    const valid = componentRows.every((row) => row.raw_material_id && Number(row.quantity) > 0 && Number(row.wastage_percent) >= 0);
    if (!valid) { show(isAr ? 'أكمل بيانات مكونات المجموعة' : 'Complete the component rows', 'error'); return; }
    const allHaveUnits = componentRows.every((row) => rawMaterials.find((material) => material.id === row.raw_material_id)?.measurement_unit);
    if (!allHaveUnits) {
      show(isAr ? 'لا يمكن استخدام خامة بدون وحدة قياس. حدد وحدة الخامة أولًا.' : 'A raw material without a measurement unit cannot be used. Set its unit first.', 'error');
      return;
    }
    setRecipeLoading(true);
    try {
      await saveInventoryUnitComponents(componentUnit.id, componentRows);
    } catch (error) {
      show(error instanceof Error ? error.message : String(error), 'error');
      setRecipeLoading(false);
      return;
    }
    await logAudit('update', 'inventory_unit_recipes', componentUnit.id, { unit_name: componentUnit.name, ingredient_count: componentRows.length });
    show(t('saveSuccess'), 'success');
    setRecipeLoading(false);
    setRecipeModalOpen(false);
  };

  const remove = async () => {
    if (!deleteId) return;
    try {
      await deleteComponentGroup(deleteId);
      show(t('deleteSuccess'), 'success');
      await logAudit('delete', 'inventory_units', deleteId);
    } catch (error) {
      show(error instanceof Error ? error.message : String(error), 'error');
    }
    setDeleteId(null);
    reloadItems();
  };

  const columns: Column<InventoryUnit>[] = [
    { key: 'code', header: t('code'), render: (unit) => <span className="font-mono text-sm">{unit.code}</span> },
    { key: 'name', header: isAr ? 'اسم مجموعة المكونات' : 'Component group', render: (unit) => <span className="font-medium text-ui-text">{unit.name}</span> },
    { key: 'cost_price', header: t('costPrice'), render: (unit) => <span className="text-sm">{formatNumber(Number(unit.cost_price), 1)}</span> },
    { key: 'sale_price', header: t('salePrice'), render: (unit) => <span className="text-sm">{formatNumber(Number(unit.sale_price), 1)}</span> },
    { key: 'actions', header: t('actions'), render: (unit) => <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
      {unit.unit_type === 'manufactured' && can('raw_materials.manage') && <button onClick={() => openComponents(unit)} className="p-1.5 rounded-md hover:bg-purple-50 text-purple-500" title={isAr ? 'مكونات المجموعة' : 'Group components'}><Beaker className="w-4 h-4" /></button>}
      {can('raw_materials.manage') && <button onClick={() => openEdit(unit)} className="ui-icon-action ui-icon-action-info"><Edit2 className="w-4 h-4" /></button>}
      {can('raw_materials.manage') && <button onClick={() => setDeleteId(unit.id)} className="ui-icon-action ui-icon-action-danger"><Trash2 className="w-4 h-4" /></button>}
    </div> },
  ];

  const fieldGrid = 'grid grid-cols-1 sm:grid-cols-2 gap-4';

  return (
    <DesignSurface testId="inventory-units-page">
      <DesignPageHeader
        title={isAr ? 'مجموعات المكونات' : 'Component Groups'}
        subtitle={isAr ? 'مجموعات خامات مسماة قابلة لإعادة الاستخدام داخل أكثر من منتج، بدون خطوة تصنيع' : 'Reusable named raw-material groups used by products, with no production step'}
        actions={can('raw_materials.manage') ? <Button size="sm" onClick={openAdd} data-testid="inventory-units-add"><Plus className="w-4 h-4" /> {isAr ? 'إضافة مجموعة' : 'Add component group'}</Button> : undefined}
      />
      <DesignPanel testId="inventory-units-table-panel">
        <DataTable columns={columns} data={items} loading={loading} emptyMessage={t('noData')} onRowClick={can('raw_materials.manage') ? openEdit : undefined} />
        <DesignPagination loaded={items.length} total={total} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} />
      </DesignPanel>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? (isAr ? 'تعديل مجموعة المكونات' : 'Edit component group') : (isAr ? 'إضافة مجموعة مكونات' : 'Add component group')} size="lg">
        <div className="space-y-4">
          <div className={fieldGrid}><Input label={t('code')} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required /><Input label={isAr ? 'اسم المجموعة' : 'Component group name'} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
          <div className={fieldGrid}><Input label={t('nameEn')} value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} /><div><label className="block text-sm font-medium text-ui-muted mb-1">{isAr ? 'النوع' : 'Type'}</label><div className="min-h-11 flex items-center rounded-lg border border-ui-border bg-ui-page-alt px-3 text-sm font-semibold text-ui-text">{isAr ? 'مجموعة مكونات' : 'Component group'}</div></div></div>
          <div className={fieldGrid}><Input label={t('costPrice')} type="number" min="0" step="0.01" value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: Number(e.target.value) || 0 })} /><Input label={t('salePrice')} type="number" min="0" step="0.01" value={form.sale_price} onChange={(e) => setForm({ ...form, sale_price: Number(e.target.value) || 0 })} /></div>
          <div className={fieldGrid}><Input label={t('minStock')} type="number" min="0" value={form.min_stock} onChange={(e) => setForm({ ...form, min_stock: Number(e.target.value) || 0 })} /><Input label={t('maxStock')} type="number" min="0" value={form.max_stock} onChange={(e) => setForm({ ...form, max_stock: Number(e.target.value) || 0 })} /></div>
          <div className={fieldGrid}><Input label={t('reorderPoint')} type="number" min="0" value={form.reorder_point} onChange={(e) => setForm({ ...form, reorder_point: Number(e.target.value) || 0 })} /><Input label={t('lowStockThreshold')} type="number" min="0" value={form.low_stock_threshold} onChange={(e) => setForm({ ...form, low_stock_threshold: Number(e.target.value) || 0 })} /></div>
          <div className={fieldGrid}><Input label={t('barcode')} value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} /><Input label={t('sku')} value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></div>
          <Textarea label={t('description')} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
          <div className="sticky bottom-0 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-ui-surface/95 backdrop-blur border-t border-ui-border flex justify-end gap-2"><Button variant="secondary" onClick={() => setModalOpen(false)}>{t('cancel')}</Button><Button onClick={save}>{t('save')}</Button></div>
        </div>
      </Modal>

      <Modal open={componentModalOpen} onClose={() => setRecipeModalOpen(false)} title={componentUnit ? `${isAr ? 'مكونات المجموعة' : 'Group components'} — ${componentUnit.name}` : (isAr ? 'مكونات المجموعة' : 'Group components')} size="lg">
        <div className="space-y-4">
          <div className="rounded-lg bg-purple-50 border border-purple-200 p-3 text-sm text-purple-800">{isAr ? 'هذه الخامات تعريف لمجموعة مكونات قابلة لإعادة الاستخدام. عند بيع منتج مرتبط بها، يتم خصم الخامات عند إرسال الطلب للمطبخ.' : 'These raw materials define a reusable component group. For linked products, raw materials are deducted when the order is sent to the kitchen.'}</div>
          {componentRows.map((row, index) => {
            const selectedMaterial = rawMaterials.find((material) => material.id === row.raw_material_id);
            const selectedUnit = selectedMaterial ? unitLabel(selectedMaterial) : '';
            return <div key={index} className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_170px_140px_auto] gap-2 items-end p-3 rounded-lg border border-ui-border">
              <select aria-label={isAr ? 'الخامة' : 'Raw material'} value={row.raw_material_id} onChange={(e) => setComponentRows((rows) => rows.map((item, i) => i === index ? { ...item, raw_material_id: e.target.value } : item))} className="min-h-11 rounded-lg border border-ui-border bg-ui-surface px-3 text-sm"><option value="" disabled>--</option>{rawMaterials.map((material) => <option key={material.id} value={material.id} disabled={!material.measurement_unit}>{materialLabel(material)}</option>)}</select>
              <Input label={selectedUnit ? `${isAr ? 'الكمية' : 'Quantity'} (${selectedUnit})` : (isAr ? 'الكمية' : 'Quantity')} type="number" min="0.0001" step="0.0001" value={row.quantity} onChange={(e) => setComponentRows((rows) => rows.map((item, i) => i === index ? { ...item, quantity: Number(e.target.value) || 0 } : item))} />
              <Input label={isAr ? 'الهالك %' : 'Wastage %'} type="number" min="0" step="0.01" value={row.wastage_percent} onChange={(e) => setComponentRows((rows) => rows.map((item, i) => i === index ? { ...item, wastage_percent: Number(e.target.value) || 0 } : item))} />
              <Button variant="outline" size="sm" onClick={() => setComponentRows((rows) => rows.filter((_, i) => i !== index))}><Trash2 className="w-4 h-4" /></Button>
            </div>;
          })}
          <Button variant="outline" onClick={() => setComponentRows((rows) => [...rows, EMPTY_COMPONENT_ROW()])}><Plus className="w-4 h-4" />{isAr ? 'إضافة خامة' : 'Add material'}</Button>
          <div className="sticky bottom-0 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-ui-surface/95 backdrop-blur border-t border-ui-border flex justify-end gap-2"><Button variant="secondary" onClick={() => setRecipeModalOpen(false)}>{t('cancel')}</Button><Button disabled={componentLoading} onClick={saveComponents}>{t('save')}</Button></div>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={remove} title={t('delete')} message={t('confirmDelete')} confirmLabel={t('delete')} cancelLabel={t('cancel')} />
    </DesignSurface>
  );
}