import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Check, X, BarChart3 } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { DesignSurface, DesignPageHeader } from '@/components/design/DesignSurface';
import { DataTable, type Column } from '@/components/DataTable';
import { Button } from '@/components/Button';
import { Input, Select, Textarea } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useCan } from '@/lib/permissions';
import { formatNumber, formatQuantity } from '@/lib/format';
import { supabase } from '@/api';
import type { WasteEntry, WasteCategory } from '@/lib/types';

const WASTE_TYPES = [
  { value: 'raw_material', ar: 'مادة خام', en: 'Raw Material' },
  { value: 'finished_good', ar: 'منتج نهائي', en: 'Finished Good' },
  { value: 'production', ar: 'هالك إنتاج تاريخي', en: 'Legacy Production Waste' },
  { value: 'expired', ar: 'منتهي الصلاحية', en: 'Expired' },
  { value: 'damaged', ar: 'تالف', en: 'Damaged' },
] as const;

type ProductOption = { id: string; name: string; name_en?: string | null; sale_price?: number | null; cost_price?: number | null };
type UnitOption = { id: string; name: string; name_en?: string | null; cost_price?: number | null };
type WarehouseOption = { id: string; name: string };

interface WasteForm {
  waste_category_id: string;
  waste_type: string;
  target_type: 'product' | 'inventory_unit';
  product_id: string;
  inventory_unit_id: string;
  warehouse_id: string;
  quantity: number;
  unit_cost: number;
  reason: string;
}

const EMPTY_FORM: WasteForm = {
  waste_category_id: '',
  waste_type: 'finished_good',
  target_type: 'product',
  product_id: '',
  inventory_unit_id: '',
  warehouse_id: '',
  quantity: 1,
  unit_cost: 0,
  reason: '',
};

export function WasteCenterPage() {
  const { lang } = useLanguage();
  const { show } = useToast();
  const can = useCan();
  const branchFilter = useBranchFilter();
  const ar = lang === 'ar';

  const [entries, setEntries] = useState<WasteEntry[]>([]);
  const [categories, setCategories] = useState<WasteCategory[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [inventoryUnits, setInventoryUnits] = useState<UnitOption[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [form, setForm] = useState<WasteForm>(EMPTY_FORM);
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const productQuery = supabase
        .from('products')
        .select('id,name,name_en,sale_price,cost_price')
        .eq('is_active', true)
        .order('name');
      if (branchFilter) productQuery.eq('branch_id', branchFilter);

      const entryQuery = supabase
        .from('waste_entries')
        .select('*, waste_category:waste_categories(*), product:products(id,name,name_en), inventory_unit:inventory_units(id,name,name_en), warehouse:warehouses(id,name)')
        .order('created_at', { ascending: false });
      if (branchFilter) entryQuery.eq('branch_id', branchFilter);

      let unitQuery = supabase.from('inventory_units').select('id,name,name_en,cost_price').eq('is_active', true).order('name');
      let warehouseQuery = supabase.from('warehouses').select('id,name').eq('is_active', true).order('name');
      if (branchFilter) {
        unitQuery = unitQuery.or(`branch_id.eq.${branchFilter},branch_id.is.null`);
        warehouseQuery = warehouseQuery.eq('branch_id', branchFilter);
      }
      const [catRes, productRes, unitRes, warehouseRes, entryRes] = await Promise.all([
        supabase.from('waste_categories').select('*').eq('is_active', true).order('name'),
        productQuery,
        unitQuery,
        warehouseQuery,
        entryQuery,
      ]);
      if (catRes.error) throw catRes.error;
      if (productRes.error) throw productRes.error;
      if (unitRes.error) throw unitRes.error;
      if (warehouseRes.error) throw warehouseRes.error;
      if (entryRes.error) throw entryRes.error;
      setCategories(catRes.data ?? []);
      setProducts((productRes.data ?? []) as ProductOption[]);
      setInventoryUnits((unitRes.data ?? []) as UnitOption[]);
      setWarehouses((warehouseRes.data ?? []) as WarehouseOption[]);
      setEntries((entryRes.data ?? []) as unknown as WasteEntry[]);
    } catch (err) {
      show((ar ? 'خطأ في التحميل: ' : 'Load error: ') + String((err as Error).message ?? err), 'error');
    } finally {
      setLoading(false);
    }
  }, [ar, branchFilter, show]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => entries.filter(e => {
    if (filterType && e.waste_type !== filterType) return false;
    if (filterStatus && e.status !== filterStatus) return false;
    return true;
  }), [entries, filterStatus, filterType]);

  const handleCreate = async () => {
    if (!form.waste_category_id || form.quantity <= 0) {
      show(ar ? 'أكمل الحقول المطلوبة' : 'Fill required fields', 'error');
      return;
    }
    if (!form.warehouse_id) {
      show(ar ? 'اختر المخزن الذي سيُخصم منه الهالك' : 'Select the warehouse to deduct from', 'error');
      return;
    }
    if ((form.target_type === 'product' && !form.product_id) || (form.target_type === 'inventory_unit' && !form.inventory_unit_id)) {
      show(ar ? 'اختر عنصر المخزون المراد تسجيل هالك له' : 'Select the wasted inventory item', 'error');
      return;
    }
    if (!branchFilter) {
      show(ar ? 'اختر الفرع أولاً' : 'Select a branch first', 'error');
      return;
    }
    try {
      const { error } = await supabase.rpc('create_waste_entry', {
        p_branch_id: branchFilter,
        p_waste_category_id: form.waste_category_id,
        p_waste_type: form.waste_type,
        p_quantity: form.quantity,
        p_unit_cost: form.unit_cost,
        p_reason: form.reason || null,
        p_product_id: form.target_type === 'product' ? form.product_id : null,
        p_inventory_unit_id: form.target_type === 'inventory_unit' ? form.inventory_unit_id : null,
        p_warehouse_id: form.warehouse_id,
      });
      if (error) throw error;
      show(ar ? 'تم تسجيل الهالك' : 'Waste recorded', 'success');
      setShowForm(false);
      setForm(EMPTY_FORM);
      void load();
    } catch (err) {
      show(String((err as Error).message ?? err), 'error');
    }
  };

  const handleApprove = async (id: string, approve: boolean) => {
    let rejectionReason: string | null = null;
    if (!approve) {
      rejectionReason = prompt(ar ? 'سبب الرفض:' : 'Rejection reason:');
      if (rejectionReason === null) return;
    }
    try {
      const { error } = await supabase.rpc('approve_waste', {
        p_waste_id: id,
        p_approve: approve,
        ...(approve ? {} : { p_rejection_reason: rejectionReason || null }),
      });
      if (error) throw error;
      show(approve ? (ar ? 'تم الاعتماد' : 'Approved') : (ar ? 'تم الرفض' : 'Rejected'), 'success');
      void load();
    } catch (err) {
      show(String((err as Error).message ?? err), 'error');
    }
  };

  const typeLabel = (v: string) => WASTE_TYPES.find(w => w.value === v)?.[ar ? 'ar' : 'en'] ?? v;
  const statusColor = (s: string) => s === 'approved' ? 'text-ui-success' : s === 'rejected' ? 'text-ui-danger' : 'text-ui-warning';

  const baseColumns: Column<WasteEntry>[] = [
    { key: 'created_at', header: ar ? 'التاريخ' : 'Date', render: r => new Date(r.created_at).toLocaleDateString() },
    { key: 'waste_type', header: ar ? 'النوع' : 'Type', render: r => typeLabel(r.waste_type) },
    { key: 'product', header: ar ? 'عنصر المخزون' : 'Inventory Item', render: r => {
      const joined = r as unknown as { product?: { name?: string; name_en?: string }; inventory_unit?: { name?: string; name_en?: string } };
      return joined.product?.name || joined.product?.name_en || joined.inventory_unit?.name || joined.inventory_unit?.name_en || '-';
    } },
    { key: 'warehouse_id', header: ar ? 'المخزن' : 'Warehouse', render: r => (r as unknown as { warehouse?: { name?: string } }).warehouse?.name || '-' },
    { key: 'waste_category', header: ar ? 'الفئة' : 'Category', render: r => {
      const cat = (r as unknown as { waste_category?: { name?: string } }).waste_category;
      return cat?.name ?? '-';
    } },
    { key: 'quantity', header: ar ? 'الكمية' : 'Qty', render: r => formatQuantity(Number(r.quantity || 0), 3) },
    { key: 'unit_cost', header: ar ? 'تكلفة الوحدة' : 'Unit Cost', render: r => formatNumber(Number(r.unit_cost || 0), 1) },
    { key: 'total_cost', header: ar ? 'الإجمالي' : 'Total', render: r => formatNumber(Number(r.total_cost || 0), 1) },
    { key: 'reason', header: ar ? 'السبب' : 'Reason', render: r => r.reason ?? '-' },
    { key: 'status', header: ar ? 'الحالة' : 'Status', render: r => <span className={`font-bold ${statusColor(r.status)}`}>{r.status === 'approved' ? (ar ? 'معتمد' : 'Approved') : r.status === 'rejected' ? (ar ? 'مرفوض' : 'Rejected') : (ar ? 'قيد المراجعة' : 'Pending')}</span> },
  ];

  const columns: Column<WasteEntry>[] = can('waste.approve')
    ? [...baseColumns, {
      key: 'actions', header: ar ? 'إجراءات' : 'Actions', render: (r: WasteEntry) => r.status === 'pending' ? (
        <div className="flex gap-1">
          <button onClick={() => void handleApprove(r.id, true)} className="text-ui-success" title={ar ? 'اعتماد' : 'Approve'}><Check className="h-4 w-4" /></button>
          <button onClick={() => void handleApprove(r.id, false)} className="text-ui-danger" title={ar ? 'رفض' : 'Reject'}><X className="h-4 w-4" /></button>
        </div>
      ) : null,
    }]
    : baseColumns;

  return (
    <DesignSurface testId="waste-center">
      <DesignPageHeader title={ar ? 'مركز الهالك' : 'Waste Center'} subtitle={ar ? 'تسجيل ومراجعة الهالك التشغيلي مع إبقاء السجلات التاريخية قابلة للعرض' : 'Record and review operational waste while keeping historical records visible.'} />
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {can('waste.create') && <Button onClick={() => setShowForm(true)}><Plus className="h-4 w-4" /> {ar ? 'تسجيل هالك' : 'Record Waste'}</Button>}
          {can('waste.report') && <Button onClick={() => setShowReport(!showReport)} variant="outline"><BarChart3 className="h-4 w-4" /> {ar ? 'التقرير' : 'Report'}</Button>}
          <Select value={filterType} onChange={e => setFilterType(e.target.value)} className="w-40">
            <option value="">{ar ? 'كل الأنواع' : 'All Types'}</option>
            {WASTE_TYPES.filter((wt) => wt.value !== 'production').map(wt => <option key={wt.value} value={wt.value}>{ar ? wt.ar : wt.en}</option>)}
          </Select>
          <Select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="w-36">
            <option value="">{ar ? 'كل الحالات' : 'All Statuses'}</option>
            <option value="pending">{ar ? 'قيد المراجعة' : 'Pending'}</option>
            <option value="approved">{ar ? 'معتمد' : 'Approved'}</option>
            <option value="rejected">{ar ? 'مرفوض' : 'Rejected'}</option>
          </Select>
        </div>
        {showReport && <WasteReport ar={ar} branchFilter={branchFilter} />}
        <DataTable columns={columns} data={filtered} loading={loading} />
      </div>

      <Modal open={showForm} onClose={() => setShowForm(false)} title={ar ? 'تسجيل هالك جديد' : 'Record Waste'}>
        <div className="space-y-3">
          <Select label={ar ? 'الفئة' : 'Category'} value={form.waste_category_id} onChange={e => setForm(f => ({ ...f, waste_category_id: e.target.value }))}>
            <option value="">{ar ? 'اختر...' : 'Select...'}</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select label={ar ? 'نوع الهالك' : 'Waste Type'} value={form.waste_type} onChange={e => setForm(f => ({ ...f, waste_type: e.target.value }))}>
            {WASTE_TYPES.map(wt => <option key={wt.value} value={wt.value}>{ar ? wt.ar : wt.en}</option>)}
          </Select>
          <Select label={ar ? 'نوع عنصر المخزون' : 'Inventory Item Type'} value={form.target_type} onChange={e => setForm(f => ({ ...f, target_type: e.target.value as WasteForm['target_type'], product_id: '', inventory_unit_id: '', unit_cost: 0 }))}>
            <option value="product">{ar ? 'منتج نهائي' : 'Finished Product'}</option>
            <option value="inventory_unit">{ar ? 'وحدة مخزون / خامة مجهزة' : 'Inventory Unit / Prepared Material'}</option>
          </Select>
          <Select label={ar ? 'المخزن (سيتم الخصم منه عند الاعتماد)' : 'Warehouse (deducted on approval)'} value={form.warehouse_id} onChange={e => setForm(f => ({ ...f, warehouse_id: e.target.value }))}>
            <option value="">{ar ? 'اختر المخزن...' : 'Select warehouse...'}</option>
            {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
          {form.target_type === 'product' ? (
            <Select label={ar ? 'المنتج' : 'Product'} value={form.product_id} onChange={e => {
              const product = products.find(p => p.id === e.target.value);
              setForm(f => ({ ...f, product_id: e.target.value, unit_cost: Number(product?.cost_price || 0) }));
            }}>
              <option value="">{ar ? 'اختر المنتج...' : 'Select product...'}</option>
              {products.map(p => <option key={p.id} value={p.id}>{ar ? p.name : (p.name_en || p.name)}</option>)}
            </Select>
          ) : (
            <Select label={ar ? 'وحدة المخزون / الخامة' : 'Inventory Unit / Material'} value={form.inventory_unit_id} onChange={e => {
              const unit = inventoryUnits.find(u => u.id === e.target.value);
              setForm(f => ({ ...f, inventory_unit_id: e.target.value, unit_cost: Number(unit?.cost_price || 0) }));
            }}>
              <option value="">{ar ? 'اختر الوحدة...' : 'Select unit...'}</option>
              {inventoryUnits.map(u => <option key={u.id} value={u.id}>{ar ? u.name : (u.name_en || u.name)}</option>)}
            </Select>
          )}
          <Input label={ar ? 'الكمية' : 'Quantity'} type="number" min={0.001} step="0.001" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: +e.target.value }))} />
          <Input label={ar ? 'تكلفة الوحدة' : 'Unit Cost'} type="number" min={0} step="0.01" value={form.unit_cost} onChange={e => setForm(f => ({ ...f, unit_cost: +e.target.value }))} />
          <Textarea label={ar ? 'السبب' : 'Reason'} value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setShowForm(false)}>{ar ? 'إلغاء' : 'Cancel'}</Button>
            <Button onClick={() => void handleCreate()}>{ar ? 'حفظ' : 'Save'}</Button>
          </div>
        </div>
      </Modal>
    </DesignSurface>
  );
}

function WasteReport({ ar, branchFilter }: { ar: boolean; branchFilter: string | null }) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const to = new Date().toISOString().slice(0, 10);
        const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
        const { data, error } = await supabase.rpc('get_waste_report', { p_branch_id: branchFilter, p_from_date: from, p_to_date: to });
        if (error) throw error;
        setRows((data ?? []) as Record<string, unknown>[]);
      } catch { /* optional report */ }
      setLoading(false);
    })();
  }, [branchFilter]);

  if (loading) return <div className="text-ui-muted text-sm py-4">{ar ? 'جاري التحميل...' : 'Loading...'}</div>;
  if (!rows.length) return <div className="text-ui-muted text-sm py-4">{ar ? 'لا توجد بيانات' : 'No data'}</div>;

  return (
    <div className="rounded-2xl border border-ui-border bg-ui-surface p-4 shadow-ui-sm">
      <h3 className="font-bold text-ui-text mb-3">{ar ? 'تقرير آخر 30 يوم' : 'Last 30 Days Report'}</h3>
      <table className="w-full text-sm">
        <thead><tr className="border-b border-ui-border text-ui-muted">
          <th className="py-2 text-start">{ar ? 'الفئة' : 'Category'}</th>
          <th className="py-2 text-start">{ar ? 'النوع' : 'Type'}</th>
          <th className="py-2 text-end">{ar ? 'الكمية' : 'Qty'}</th>
          <th className="py-2 text-end">{ar ? 'التكلفة' : 'Cost'}</th>
          <th className="py-2 text-end">{ar ? 'عدد' : 'Count'}</th>
        </tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={i} className="border-b border-ui-border">
            <td className="py-2">{String(r.waste_category)}</td>
            <td className="py-2">{String(r.waste_type)}</td>
            <td className="py-2 text-end">{formatQuantity(Number(r.total_quantity), 3)}</td>
            <td className="py-2 text-end">{formatNumber(Number(r.total_cost), 1)}</td>
            <td className="py-2 text-end">{formatNumber(Number(r.entry_count), 0)}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}