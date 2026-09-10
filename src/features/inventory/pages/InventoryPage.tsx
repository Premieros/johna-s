import { useEffect, useState } from 'react';
import { AlertTriangle, Download, Edit2 } from 'lucide-react';
import { supabase } from '@/api';
import * as api from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { useCan } from '@/lib/permissions';
import { DesignSurface, DesignPageHeader, DesignSearch, DesignPanel, DesignPagination } from '@/components/design';
import { DataTable, type Column } from '@/components/DataTable';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { BranchBadge } from '@/components/BranchBadge';
import { formatNumber } from '@/lib/format';
import { exportToExcel } from '@/lib/excel';
import { logAudit } from '@/lib/audit';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import { useBranches } from '@/hooks/useBranches';
import { RawMaterialBranchStockPanel } from '../components/RawMaterialBranchStockPanel';
import type { Inventory, Warehouse } from '@/lib/types';

export function InventoryPage() {
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';
  const { show } = useToast();
  const can = useCan();
  const { branches } = useBranches();
  const { rows: items, loading, error, total, hasMore, loadMore, loadingMore, refresh: reloadInventory } = usePaginatedRows<Inventory>({
    table: 'inventory',
    select: '*, product:products(*), warehouse:warehouses(*)',
    order: { column: 'updated_at', ascending: false },
    pageSize: 100,
  });
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [componentIds, setComponentIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [filterWarehouse, setFilterWarehouse] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [adjustModal, setAdjustModal] = useState<Inventory | null>(null);
  const [adjustQty, setAdjustQty] = useState(0);
  const [adjustReason, setAdjustReason] = useState('');

  useEffect(() => {
    async function loadMeta() {
      const [wh, pc] = await Promise.all([
        supabase.from('warehouses').select('*').order('name'),
        supabase.from('product_components').select('component_product_id'),
      ]);
      setWarehouses((wh.data as Warehouse[]) || []);
      setComponentIds(new Set((pc.data || []).map((row: { component_product_id: string }) => row.component_product_id)));
    }
    void loadMeta();
  }, []);

  const filtered = items.filter((item) => {
    if (filterWarehouse && item.warehouse_id !== filterWarehouse) return false;
    if (filterType === 'components' && !componentIds.has(item.product_id)) return false;
    if (filterType === 'ready' && (item.product?.product_type !== 'ready' || componentIds.has(item.product_id))) return false;
    if (!search) return true;
    const query = search.toLocaleLowerCase();
    return item.product?.name.toLocaleLowerCase().includes(query) || item.product?.barcode?.includes(search);
  });

  const openAdjust = (inventory: Inventory) => {
    if (!can('inventory.adjust')) return;
    setAdjustModal(inventory);
    setAdjustQty(inventory.quantity);
    setAdjustReason('');
  };

  const saveAdjust = async () => {
    if (!adjustModal || !can('inventory.adjust')) return;
    if (!adjustReason.trim()) {
      show(isAr ? 'سبب التسوية مطلوب' : 'Adjustment reason is required', 'error');
      return;
    }
    const { data, error: adjustError } = await api.inventory.adjustStock({
      p_inventory_id: adjustModal.id,
      p_new_quantity: adjustQty,
      p_reason: adjustReason.trim(),
    });
    if (adjustError) { show(adjustError.message, 'error'); return; }
    const result = data as { success: boolean; error?: string; detail?: string } | null;
    if (!result?.success) { show(result?.detail || result?.error || t('error'), 'error'); return; }
    await logAudit('update', 'inventory', adjustModal.id, { from: adjustModal.quantity, to: adjustQty, reason: adjustReason.trim() });
    show(t('saveSuccess'), 'success');
    setAdjustModal(null);
    reloadInventory();
  };

  const handleExport = () => {
    exportToExcel(items.map((item) => ({
      Product: item.product?.name || '',
      Barcode: item.product?.barcode || '',
      Warehouse: item.warehouse?.name || '',
      Branch: branches.find((branch) => branch.id === item.warehouse?.branch_id)?.name || '',
      Quantity: item.quantity,
      LowStockThreshold: item.product?.low_stock_threshold || 0,
    })), 'inventory');
  };

  const columns: Column<Inventory>[] = [
    { key: 'product', header: t('productName'), render: (item) => (
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ui-page-alt text-xs font-bold text-ui-subtle">{(item.product?.name || '?')[0]}</div>
        <div>
          <p className="font-medium text-ui-text">{item.product?.name || '-'}</p>
          <div className="flex items-center gap-1">
            <p className="text-xs text-ui-subtle">{item.product?.barcode || '-'}</p>
            {componentIds.has(item.product_id) && <span className="rounded bg-ui-page-alt px-1 py-0.5 text-[10px] font-medium text-ui-subtle">{t('component')}</span>}
            {item.product?.product_type === 'manufactured' && <span className="rounded bg-purple-100 px-1 py-0.5 text-[10px] font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">{t('manufactured')}</span>}
          </div>
        </div>
      </div>
    )},
    { key: 'warehouse', header: t('warehouse'), render: (item) => item.warehouse?.name || '-' },
    { key: 'branch', header: t('branch'), render: (item) => <BranchBadge name={branches.find((branch) => branch.id === item.warehouse?.branch_id)?.name || '-'} /> },
    { key: 'quantity', header: t('quantity'), render: (item) => {
      const low = item.quantity < (item.product?.low_stock_threshold || 5);
      return <div className="flex items-center gap-2"><span className={`font-semibold ${low ? 'text-ui-danger' : 'text-ui-text'}`}>{formatNumber(item.quantity)}</span>{low && <AlertTriangle className="h-4 w-4 text-ui-warning" />}</div>;
    }},
    { key: 'status', header: t('status'), render: (item) => {
      const low = item.quantity < (item.product?.low_stock_threshold || 5);
      const out = item.quantity <= 0;
      return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${out ? 'bg-ui-danger-soft text-ui-danger' : low ? 'bg-ui-warning-soft text-ui-warning' : 'bg-ui-success-soft text-ui-success'}`}>{out ? t('outOfStock') : low ? t('lowStock') : t('inStock')}</span>;
    }},
    { key: 'actions', header: t('actions'), render: (item) => can('inventory.adjust') ? (
      <button onClick={(event) => { event.stopPropagation(); openAdjust(item); }} className="rounded-md p-1.5 text-ui-info hover:bg-ui-info-soft" title={t('adjustStock')}><Edit2 className="h-4 w-4" /></button>
    ) : null },
  ];

  return (
    <DesignSurface testId="inventory-page">
      <DesignPageHeader title={t('inventory')} actions={<Button variant="outline" size="sm" onClick={handleExport}><Download className="h-4 w-4" /> {t('exportExcel')}</Button>} />
      <DesignPanel testId="inventory-search-panel">
        <div className="flex flex-col gap-3 sm:flex-row">
          <DesignSearch value={search} onChange={setSearch} className="flex-1" label={t('search')} placeholder={t('search')} testId="inventory-search" />
          <Select value={filterWarehouse} onChange={(event) => setFilterWarehouse(event.target.value)} className="sm:w-48"><option value="">{t('all')} - {t('warehouses')}</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</Select>
          <Select value={filterType} onChange={(event) => setFilterType(event.target.value)} className="sm:w-40"><option value="all">{t('all')}</option><option value="ready">{t('readyProduct')}</option><option value="components">{t('component')}</option></Select>
        </div>
      </DesignPanel>
      <DesignPanel testId="inventory-table-panel">
        <DataTable columns={columns} data={filtered} loading={loading} error={error} emptyMessage={t('noData')} onRowClick={can('inventory.adjust') ? openAdjust : undefined} />
        <DesignPagination loaded={items.length} total={total} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} />
      </DesignPanel>

      <RawMaterialBranchStockPanel />

      <Modal open={!!adjustModal} onClose={() => setAdjustModal(null)} title={t('adjustStock')} size="sm">
        {adjustModal && <div className="space-y-4">
          <div><p className="text-sm text-ui-subtle">{t('productName')}</p><p className="font-medium text-ui-text">{adjustModal.product?.name}</p></div>
          <div><p className="text-sm text-ui-subtle">{t('warehouse')}</p><p className="font-medium text-ui-text">{adjustModal.warehouse?.name}</p></div>
          <Input label={t('currentStock')} type="number" step="0.0001" value={adjustQty} onChange={(event) => setAdjustQty(parseFloat(event.target.value) || 0)} />
          <Input label={t('reason')} value={adjustReason} onChange={(event) => setAdjustReason(event.target.value)} placeholder={isAr ? 'مثال: جرد، تالف، تصحيح' : 'e.g. count, damaged, correction'} required />
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setAdjustModal(null)}>{t('cancel')}</Button><Button onClick={saveAdjust}>{t('save')}</Button></div>
        </div>}
      </Modal>
    </DesignSurface>
  );
}
