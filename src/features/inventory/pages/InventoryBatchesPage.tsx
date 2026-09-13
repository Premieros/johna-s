import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Clock, Layers } from 'lucide-react';
import { supabase } from '@/api';
import * as api from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { useCan } from '@/lib/permissions';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { DesignSurface, DesignPageHeader, DesignSearch, DesignPanel, DesignPagination } from '@/components/design';
import { DataTable, type Column } from '@/components/DataTable';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { BranchBadge } from '@/components/BranchBadge';
import { formatDate, formatNumber } from '@/lib/format';
import { daysUntilExpiry, expiryStatus } from '@/lib/inventoryExpiry';
import { logAudit } from '@/lib/audit';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import type { Branch, Product, Warehouse } from '@/lib/types';

interface BatchRow {
  id: string;
  product_id: string;
  warehouse_id: string;
  branch_id: string;
  batch_number: string | null;
  quantity: number;
  unit_cost: number;
  production_date: string | null;
  expiry_date: string | null;
  source_type: string;
  source_id: string | null;
  created_at: string;
  product?: Product | null;
  warehouse?: Warehouse | null;
  branch?: Branch | null;
}

const EMPTY_FORM = {
  branch_id: '', warehouse_id: '', product_id: '', quantity: '1', unit_cost: '0',
  batch_number: '', production_date: '', expiry_date: '', source_type: 'opening', notes: '',
};

export function InventoryBatchesPage() {
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';
  const { show } = useToast();
  const can = useCan();
  const branchFilter = useBranchFilter();
  const { rows: batches, loading, error, total, hasMore, loadMore, loadingMore, refresh: reloadBatches } = usePaginatedRows<BatchRow>({
    table: 'inventory_batches',
    select: '*, product:products(*), warehouse:warehouses(*), branch:branches(*)',
    order: { column: 'expiry_date', ascending: true },
    branch_id: branchFilter,
    pageSize: 100,
  });
  const [branches, setBranches] = useState<Branch[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [filter, setFilter] = useState('all');
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const sourceOptions = [
    { key: 'opening', label: t('sourceOpening') },
    { key: 'purchase', label: t('sourcePurchase') },
    { key: 'production', label: t('sourceProduction') },
    { key: 'batch', label: t('sourceBatch') },
  ];

  useEffect(() => {
    async function loadMeta() {
      const [branchRes, warehouseRes, productRes] = await Promise.all([
        supabase.from('branches').select('*').eq('is_active', true).order('name'),
        supabase.from('warehouses').select('*').eq('is_active', true).order('name'),
        supabase.from('products').select('*').eq('is_active', true).order('name'),
      ]);
      setBranches((branchRes.data as Branch[]) || []);
      setWarehouses((warehouseRes.data as Warehouse[]) || []);
      setProducts((productRes.data as Product[]) || []);
    }
    void loadMeta();
  }, []);

  const rowsWithStatus = useMemo(() => batches.map((batch) => ({ ...batch, days: daysUntilExpiry(batch.expiry_date) })), [batches]);
  const filtered = rowsWithStatus.filter((batch) => {
    if (warehouseId && batch.warehouse_id !== warehouseId) return false;
    if (filter === 'expiring' && (batch.days === null || batch.days > 90 || batch.days < 0)) return false;
    if (filter === 'expired' && (batch.days === null || batch.days >= 0)) return false;
    if (!search) return true;
    const query = search.toLocaleLowerCase();
    return (batch.batch_number || '').toLocaleLowerCase().includes(query) || (batch.product?.name || '').toLocaleLowerCase().includes(query) || (batch.product?.barcode || '').toLocaleLowerCase().includes(query);
  });
  const expiredCount = rowsWithStatus.filter((batch) => batch.days !== null && batch.days < 0).length;
  const expiringCount = rowsWithStatus.filter((batch) => batch.days !== null && batch.days >= 0 && batch.days <= 90).length;

  const openAdd = () => {
    if (!can('inventory.adjust')) return;
    setForm({ ...EMPTY_FORM, branch_id: branchFilter || '' });
    setAddOpen(true);
  };

  const saveBatch = async () => {
    if (!can('inventory.adjust')) return;
    if (!form.branch_id || !form.warehouse_id || !form.product_id) { show(t('required'), 'error'); return; }
    const quantity = parseFloat(form.quantity);
    if (!quantity || quantity <= 0) { show(`${t('required')}: ${t('batchQty')}`, 'error'); return; }
    const { data, error: batchError } = await api.inventory.addInventoryBatch({
      p_product_id: form.product_id,
      p_warehouse_id: form.warehouse_id,
      p_branch_id: form.branch_id,
      p_quantity: quantity,
      p_unit_cost: parseFloat(form.unit_cost) || 0,
      p_batch_number: form.batch_number || null,
      p_production_date: form.production_date || null,
      p_expiry_date: form.expiry_date || null,
      p_source_type: form.source_type,
      p_notes: form.notes || null,
    });
    if (batchError) { show(batchError.message, 'error'); return; }
    const result = data as { success?: boolean; error?: string; detail?: string } | null;
    if (!result?.success) { show(result?.detail || result?.error || t('error'), 'error'); return; }
    await logAudit('create', 'inventory_batches', undefined, { product_id: form.product_id, batch_number: form.batch_number, quantity });
    show(t('batchSaved'), 'success');
    setAddOpen(false);
    reloadBatches();
  };

  const statusPill = (days: number | null) => {
    const status = expiryStatus(days);
    if (!status) return <span className="text-xs text-ui-subtle">-</span>;
    const expired = status.state === 'expired';
    return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${expired ? 'bg-ui-danger-soft text-ui-danger' : 'bg-ui-warning-soft text-ui-warning'}`}>{expired ? <AlertTriangle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}{expired ? t('batchStatusExpired') : t('batchStatusExpiring')}</span>;
  };

  const columns: Column<BatchRow & { days: number | null }>[] = [
    { key: 'product', header: t('product'), render: (batch) => <div><p className="font-medium text-ui-text">{batch.product?.name || '-'}</p><p className="text-xs text-ui-subtle">{batch.product?.barcode || ''}</p></div> },
    { key: 'batch_number', header: t('batchNumber'), render: (batch) => batch.batch_number || '-' },
    { key: 'warehouse', header: t('warehouse'), render: (batch) => batch.warehouse?.name || '-' },
    { key: 'branch', header: t('branch'), render: (batch) => <BranchBadge name={batch.branch?.name || '-'} /> },
    { key: 'quantity', header: t('quantity'), render: (batch) => formatNumber(Number(batch.quantity)) },
    { key: 'unit_cost', header: t('unitCost'), render: (batch) => formatNumber(Number(batch.unit_cost), 2) },
    { key: 'production_date', header: t('productionDate'), render: (batch) => batch.production_date ? formatDate(batch.production_date, lang) : '-' },
    { key: 'expiry_date', header: t('expiryDate'), render: (batch) => batch.expiry_date ? formatDate(batch.expiry_date, lang) : '-' },
    { key: 'status', header: t('status'), render: (batch) => statusPill(batch.days) },
    { key: 'source_type', header: t('batchSource'), render: (batch) => <span className="rounded-full bg-ui-page-alt px-2 py-0.5 text-xs font-medium text-ui-muted">{sourceOptions.find((source) => source.key === batch.source_type)?.label || batch.source_type}</span> },
  ];

  return (
    <DesignSurface testId="inventory-batches-page">
      <DesignPageHeader title={t('inventoryBatches')} subtitle={isAr ? 'إدارة الدفعات وتواريخ الصلاحية (FIFO)' : 'Manage lots/batches and expiry tracking (FIFO)'} actions={can('inventory.adjust') ? <Button size="sm" onClick={openAdd}><Layers className="h-4 w-4" /> {t('newBatch')}</Button> : undefined} />
      <DesignPanel testId="batches-expiry-summary"><div className="grid gap-3 sm:grid-cols-3"><div className="rounded-ui-lg border border-ui-border bg-ui-page p-4"><p className="text-xs font-medium uppercase tracking-wide text-ui-subtle">{t('expiredBatches')}</p><p className="mt-1 text-2xl font-bold text-ui-danger">{expiredCount}</p></div><div className="rounded-ui-lg border border-ui-border bg-ui-page p-4"><p className="text-xs font-medium uppercase tracking-wide text-ui-subtle">{t('expiringBatches')}</p><p className="mt-1 text-2xl font-bold text-ui-warning">{expiringCount}</p></div><div className="rounded-ui-lg border border-ui-border bg-ui-page p-4"><p className="text-xs font-medium uppercase tracking-wide text-ui-subtle">{t('totalValue')}</p><p className="mt-1 text-2xl font-bold text-ui-text">{formatNumber(rowsWithStatus.reduce((sum, batch) => sum + Number(batch.quantity) * Number(batch.unit_cost), 0), 2)}</p></div></div></DesignPanel>
      <DesignPanel testId="batches-search-panel"><div className="flex flex-col gap-3 sm:flex-row"><DesignSearch value={search} onChange={setSearch} className="flex-1" label={t('search')} placeholder={t('search')} testId="batches-search" /><Select value={filter} onChange={(event) => setFilter(event.target.value)} className="sm:w-40"><option value="all">{t('all')}</option><option value="expiring">{t('expiringBatches')}</option><option value="expired">{t('expiredBatches')}</option></Select><Select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} className="sm:w-44"><option value="">{t('all')} - {t('warehouses')}</option>{warehouses.filter((warehouse) => !branchFilter || warehouse.branch_id === branchFilter).map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</Select></div></DesignPanel>
      <DesignPanel testId="batches-table-panel"><DataTable columns={columns} data={filtered} loading={loading} error={error} emptyMessage={t('noData')} /><DesignPagination loaded={batches.length} total={total} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} /></DesignPanel>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title={t('newBatch')} size="lg">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2"><div><label className="block text-sm font-medium text-ui-muted mb-1">{t('branch')}</label><div className="rounded-md border border-ui-border bg-ui-page-alt px-3 py-2 text-sm text-ui-text">{branches.find((branch) => branch.id === form.branch_id)?.name || '-'}</div></div><Select label={t('warehouse')} value={form.warehouse_id} onChange={(event) => setForm({ ...form, warehouse_id: event.target.value })}><option value="">{t('warehouse')}</option>{warehouses.filter((warehouse) => !form.branch_id || warehouse.branch_id === form.branch_id).map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</Select></div>
          <Select label={t('product')} value={form.product_id} onChange={(event) => setForm({ ...form, product_id: event.target.value })}><option value="">{t('product')}</option>{products.filter((product) => !form.branch_id || product.branch_id === form.branch_id).map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</Select>
          <div className="grid gap-3 sm:grid-cols-3"><Input label={t('batchQty')} type="number" step="0.0001" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /><Input label={t('unitCost')} type="number" step="0.01" value={form.unit_cost} onChange={(event) => setForm({ ...form, unit_cost: event.target.value })} /><Select label={t('batchSource')} value={form.source_type} onChange={(event) => setForm({ ...form, source_type: event.target.value })}>{sourceOptions.map((source) => <option key={source.key} value={source.key}>{source.label}</option>)}</Select></div>
          <div className="grid gap-3 sm:grid-cols-3"><Input label={t('batchNumber')} value={form.batch_number} onChange={(event) => setForm({ ...form, batch_number: event.target.value })} /><Input label={t('productionDate')} type="date" value={form.production_date} onChange={(event) => setForm({ ...form, production_date: event.target.value })} /><Input label={t('expiryDate')} type="date" value={form.expiry_date} onChange={(event) => setForm({ ...form, expiry_date: event.target.value })} /></div>
          <Input label={t('notes')} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setAddOpen(false)}>{t('cancel')}</Button><Button onClick={saveBatch}>{t('save')}</Button></div>
        </div>
      </Modal>
    </DesignSurface>
  );
}
