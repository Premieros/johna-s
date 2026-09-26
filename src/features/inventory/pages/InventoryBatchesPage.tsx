import { useMemo, useState } from 'react';
import { AlertTriangle, Clock } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { DesignSurface, DesignPageHeader, DesignSearch, DesignPanel, DesignPagination } from '@/components/design';
import { DataTable, type Column } from '@/components/DataTable';
import { Select } from '@/components/Input';
import { BranchBadge } from '@/components/BranchBadge';
import { formatDate, formatNumber } from '@/lib/format';
import { daysUntilExpiry, expiryStatus } from '@/lib/inventoryExpiry';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import type { Branch, Warehouse, RawMaterial } from '@/lib/types';

interface BatchRow {
  id: string;
  raw_material_id: string;
  warehouse_id: string | null;
  branch_id: string;
  batch_number: string | null;
  quantity: number;
  unit_cost: number;
  production_date: string | null;
  expiry_date: string | null;
  source_type: string;
  source_id: string | null;
  created_at: string;
  raw_material?: RawMaterial | null;
  warehouse?: Warehouse | null;
  branch?: Branch | null;
}

export function InventoryBatchesPage() {
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';
  const branchFilter = useBranchFilter();
  const { rows: batches, loading, error, total, hasMore, loadMore, loadingMore } = usePaginatedRows<BatchRow>({
    table: 'raw_material_batches',
    select: '*, raw_material:raw_materials(*), warehouse:warehouses(*), branch:branches(*)',
    order: { column: 'created_at', ascending: false },
    branch_id: branchFilter,
    pageSize: 100,
  });

  const [search, setSearch] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [filter, setFilter] = useState('all');

  const warehouses = useMemo(() => {
    const map = new Map<string, Warehouse>();
    for (const batch of batches) if (batch.warehouse?.id) map.set(batch.warehouse.id, batch.warehouse);
    return [...map.values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [batches]);

  const rowsWithStatus = useMemo(() => batches.map((batch) => ({ ...batch, days: daysUntilExpiry(batch.expiry_date) })), [batches]);
  const filtered = rowsWithStatus.filter((batch) => {
    if (warehouseId && batch.warehouse_id !== warehouseId) return false;
    if (filter === 'positive' && Number(batch.quantity) <= 0) return false;
    if (filter === 'expiring' && (batch.days === null || batch.days > 90 || batch.days < 0)) return false;
    if (filter === 'expired' && (batch.days === null || batch.days >= 0)) return false;
    if (!search) return true;
    const query = search.toLocaleLowerCase();
    return (batch.batch_number || '').toLocaleLowerCase().includes(query)
      || (batch.raw_material?.name || '').toLocaleLowerCase().includes(query)
      || (batch.warehouse?.name || '').toLocaleLowerCase().includes(query);
  });

  const statusPill = (days: number | null) => {
    const status = expiryStatus(days);
    if (!status) return <span className="text-xs text-ui-subtle">-</span>;
    const expired = status.state === 'expired';
    return <span className={'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ' + (expired ? 'bg-ui-danger-soft text-ui-danger' : 'bg-ui-warning-soft text-ui-warning')}>{expired ? <AlertTriangle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}{expired ? t('batchStatusExpired') : t('batchStatusExpiring')}</span>;
  };

  const columns: Column<BatchRow & { days: number | null }>[] = [
    { key: 'raw_material', header: isAr ? 'الخامة' : 'Raw Material', render: (batch) => <div><p className="font-medium text-ui-text">{batch.raw_material?.name || '-'}</p><p className="text-xs text-ui-subtle">{batch.raw_material?.code || ''}</p></div> },
    { key: 'batch_number', header: t('batchNumber'), render: (batch) => batch.batch_number || '-' },
    { key: 'warehouse', header: t('warehouse'), render: (batch) => batch.warehouse?.name || '-' },
    { key: 'branch', header: t('branch'), render: (batch) => <BranchBadge name={batch.branch?.name || '-'} /> },
    { key: 'quantity', header: t('quantity'), render: (batch) => formatNumber(Number(batch.quantity)) },
    { key: 'unit_cost', header: t('unitCost'), render: (batch) => formatNumber(Number(batch.unit_cost), 2) },
    { key: 'expiry_date', header: t('expiryDate'), render: (batch) => batch.expiry_date ? formatDate(batch.expiry_date, lang) : '-' },
    { key: 'status', header: t('status'), render: (batch) => statusPill(batch.days) },
    { key: 'source_type', header: t('batchSource'), render: (batch) => <span className="rounded-full bg-ui-page-alt px-2 py-0.5 text-xs font-medium text-ui-muted">{batch.source_type || '-'}</span> },
  ];

  return (
    <DesignSurface testId="inventory-batches-page">
      <DesignPageHeader
        title={isAr ? 'دفعات الخامات FIFO' : 'Raw Material FIFO Batches'}
        subtitle={isAr ? 'عرض دفعات الخامات الفعلية داخل المخازن. الإضافة تتم من الشراء والجرد والحركات التشغيلية، وليس بإنشاء رصيد منتج.' : 'View actual raw-material lots by warehouse. Lots are created by purchasing, stock count and operational movements, not finished-product stock.'}
      />
      <DesignPanel testId="batches-search-panel">
        <div className="flex flex-col gap-3 sm:flex-row">
          <DesignSearch value={search} onChange={setSearch} className="flex-1" label={t('search')} placeholder={isAr ? 'الخامة أو رقم الدفعة أو المخزن' : 'Raw material, batch or warehouse'} testId="batches-search" />
          <Select value={filter} onChange={(event) => setFilter(event.target.value)} className="sm:w-44">
            <option value="all">{t('all')}</option>
            <option value="positive">{isAr ? 'رصيد موجب' : 'Positive balance'}</option>
            <option value="expiring">{t('expiringBatches')}</option>
            <option value="expired">{t('expiredBatches')}</option>
          </Select>
          <Select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} className="sm:w-48">
            <option value="">{t('all')} - {t('warehouses')}</option>
            {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
          </Select>
        </div>
      </DesignPanel>
      <DesignPanel testId="batches-table-panel">
        <DataTable columns={columns} data={filtered} loading={loading} error={error} emptyMessage={t('noData')} />
        <DesignPagination loaded={batches.length} total={total} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} />
      </DesignPanel>
    </DesignSurface>
  );
}
