import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpenText } from 'lucide-react';
import { supabase } from '@/api';
import { rpc } from '@/api/rpc';
import { useLanguage } from '@/context/LanguageContext';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useHistoryAccess } from '@/lib/useHistoryAccess';
import { userFacingErrorMessage } from '@/lib/userFacingError';
import { DesignSurface, DesignPageHeader, DesignSearch, DesignPanel, DesignPagination } from '@/components/design';
import { DataTable, type Column } from '@/components/DataTable';
import { BranchBadge } from '@/components/BranchBadge';
import { Select } from '@/components/Input';
import { formatNumber, formatDateTime } from '@/lib/format';
import { exportToExcel } from '@/lib/excel';

const PAGE_SIZE = 50;

interface LedgerRpcRow {
  id: number;
  branch_id: string;
  warehouse_id: string | null;
  product_id: string | null;
  raw_material_id: string | null;
  batch_number: string | null;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  before_qty: number | null;
  after_qty: number | null;
  entry_type: string;
  reference_type: string | null;
  reference_id: string | null;
  reference_number: string | null;
  created_at: string;
  product_name: string | null;
  raw_material_name: string | null;
  warehouse_name: string | null;
}

interface LedgerRow extends Omit<LedgerRpcRow, 'id'> {
  id: string;
  ledger_id: number;
}

export function InventoryLedgerPage() {
  const { t, lang } = useLanguage();
  const branchFilter = useBranchFilter();
  const history = useHistoryAccess();

  const [entryType, setEntryType] = useState('all');
  const [branchId, setBranchId] = useState(branchFilter || '');
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const requestGeneration = useRef(0);

  const entryTypes: { key: string; label: string }[] = [
    { key: 'opening', label: t('entryOpening') },
    { key: 'purchase', label: t('entryPurchase') },
    { key: 'sale', label: t('entrySale') },
    { key: 'refund', label: t('entryRefund') },
    { key: 'production', label: t('entryProduction') },
    { key: 'waste', label: t('entryWaste') },
    { key: 'transfer', label: t('entryTransfer') },
    { key: 'adjustment', label: t('entryAdjustment') },
  ];

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(id);
  }, [search]);

  useEffect(() => {
    async function loadBranches() {
      const br = await supabase.from('branches').select('id, name').eq('is_active', true).order('name');
      setBranches((br.data as { id: string; name: string }[]) || []);
    }
    void loadBranches();
  }, []);

  const fetchPage = useCallback(async (reset: boolean) => {
    const generation = reset ? ++requestGeneration.current : requestGeneration.current;
    const cursor = !reset && rows.length > 0 ? rows[rows.length - 1] : null;

    if (reset) {
      setLoading(true);
      setError(null);
    } else {
      setLoadingMore(true);
    }

    try {
      const { data, error: rpcError } = await rpc<LedgerRpcRow[]>('search_inventory_ledger', {
        p_branch_id: branchId || null,
        p_entry_type: entryType === 'all' ? null : entryType,
        p_search: debouncedSearch || null,
        p_min_created_at: history.minIso || null,
        p_before_created_at: cursor?.created_at || null,
        p_before_id: cursor?.ledger_id || null,
        p_limit: PAGE_SIZE + 1,
      });

      if (generation !== requestGeneration.current) return;

      if (rpcError) {
        setError(userFacingErrorMessage(rpcError, lang === 'ar' ? 'ar' : 'en'));
        if (reset) {
          setRows([]);
          setTotal(0);
          setHasMore(false);
        }
        return;
      }

      const fetched = (data || []).map((row) => ({ ...row, id: String(row.id), ledger_id: Number(row.id) }));
      const page = fetched.slice(0, PAGE_SIZE);
      const more = fetched.length > PAGE_SIZE;

      setRows((prev) => {
        const next = reset ? page : [...prev, ...page];
        setTotal(more ? null : next.length);
        return next;
      });
      setHasMore(more);
      setError(null);
    } catch (err) {
      if (generation !== requestGeneration.current) return;
      setError(userFacingErrorMessage(err, lang === 'ar' ? 'ar' : 'en'));
      if (reset) {
        setRows([]);
        setTotal(0);
        setHasMore(false);
      }
    } finally {
      if (generation === requestGeneration.current) {
        if (reset) setLoading(false);
        else setLoadingMore(false);
      }
    }
  }, [branchId, entryType, debouncedSearch, history.minIso, lang, rows]);

  useEffect(() => {
    void fetchPage(true);
    // rows changes after each fetch; only query inputs should reset page 1.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, entryType, debouncedSearch, history.minIso, lang]);

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || !hasMore) return;
    await fetchPage(false);
  }, [fetchPage, hasMore, loading, loadingMore]);

  const branchName = (id: string | null | undefined) => branches.find((br) => br.id === id)?.name || '-';

  const handleExport = async () => {
    const all: LedgerRow[] = [];
    let beforeCreatedAt: string | null = null;
    let beforeId: number | null = null;

    while (true) {
      const { data, error: rpcError } = await rpc<LedgerRpcRow[]>('search_inventory_ledger', {
        p_branch_id: branchId || null,
        p_entry_type: entryType === 'all' ? null : entryType,
        p_search: debouncedSearch || null,
        p_min_created_at: history.minIso || null,
        p_before_created_at: beforeCreatedAt,
        p_before_id: beforeId,
        p_limit: PAGE_SIZE + 1,
      });
      if (rpcError) {
        setError(userFacingErrorMessage(rpcError, lang === 'ar' ? 'ar' : 'en'));
        return;
      }

      const fetched = (data || []).map((row) => ({ ...row, id: String(row.id), ledger_id: Number(row.id) }));
      const page = fetched.slice(0, PAGE_SIZE);
      all.push(...page);
      if (fetched.length <= PAGE_SIZE || page.length === 0) break;

      const cursor = page[page.length - 1];
      beforeCreatedAt = cursor.created_at;
      beforeId = cursor.ledger_id;
    }

    exportToExcel(all.map((r) => ({
      Date: r.created_at,
      Type: entryTypes.find((x) => x.key === r.entry_type)?.label || r.entry_type,
      Item: r.product_name || r.raw_material_name || '-',
      Branch: branchName(r.branch_id),
      Reference: r.reference_number || '',
      Batch: r.batch_number || '',
      Quantity: r.quantity,
      UnitCost: r.unit_cost,
      TotalCost: r.total_cost,
      Before: r.before_qty ?? '',
      After: r.after_qty ?? '',
    })), 'inventory-ledger');
  };

  const typePill = (type: string) => {
    const map: Record<string, string> = {
      opening: 'bg-ui-page-alt text-ui-muted',
      purchase: 'bg-ui-info-soft text-ui-info',
      sale: 'bg-ui-success-soft text-ui-success dark:text-ui-success',
      refund: 'bg-ui-info-soft text-ui-info',
      production: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
      waste: 'bg-ui-warning-soft text-ui-warning',
      transfer: 'bg-ui-info-soft text-ui-info',
      adjustment: 'bg-ui-danger-soft text-ui-danger',
    };
    return <span className={'px-2 py-0.5 rounded-full text-xs font-medium ' + (map[type] || map.opening)}>
      {entryTypes.find((x) => x.key === type)?.label || type}
    </span>;
  };

  const columns: Column<LedgerRow>[] = [
    { key: 'created_at', header: t('from'), render: (r) => (
      <div className="text-sm">
        <p className="text-ui-text">{formatDateTime(r.created_at, lang)}</p>
        <p className="text-xs text-ui-subtle">#{r.id}</p>
      </div>
    )},
    { key: 'entry_type', header: t('entryType'), render: (r) => typePill(r.entry_type) },
    { key: 'item', header: t('product'), render: (r) => (
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-ui-page-alt flex items-center justify-center text-xs font-bold text-ui-subtle">
          <BookOpenText className="w-4 h-4" />
        </div>
        <div>
          <p className="font-medium text-ui-text">{r.product_name || r.raw_material_name || '-'}</p>
          {r.product_id && <p className="text-xs text-purple-500 dark:text-purple-400">{t('product')}</p>}
          {r.raw_material_id && <p className="text-xs text-ui-success dark:text-ui-success">{t('rawMaterial')}</p>}
        </div>
      </div>
    )},
    { key: 'warehouse', header: t('warehouse'), render: (r) => r.warehouse_name || '-' },
    { key: 'branch', header: t('branch'), render: (r) => <BranchBadge name={branchName(r.branch_id)} /> },
    { key: 'batch', header: t('batchNumber'), render: (r) => r.batch_number || '-' },
    { key: 'quantity', header: t('quantity'), render: (r) => (
      <span className={'font-semibold ' + (r.quantity >= 0 ? 'text-ui-success dark:text-ui-success' : 'text-ui-danger')}>
        {r.quantity >= 0 ? '+' : ''}{formatNumber(Number(r.quantity))}
      </span>
    )},
    { key: 'before_qty', header: lang === 'ar' ? 'الرصيد قبل' : 'Before', render: (r) => r.before_qty == null ? '-' : formatNumber(Number(r.before_qty)) },
    { key: 'after_qty', header: lang === 'ar' ? 'الرصيد بعد' : 'After', render: (r) => r.after_qty == null ? '-' : formatNumber(Number(r.after_qty)) },
    { key: 'unit_cost', header: t('unitCost'), render: (r) => formatNumber(Number(r.unit_cost), 2) },
    { key: 'total_cost', header: t('totalCost'), render: (r) => formatNumber(Number(r.total_cost), 2) },
    { key: 'reference', header: t('referenceNumber'), render: (r) => r.reference_number || '-' },
  ];

  return (
    <DesignSurface testId="inventory-ledger-page">
      <DesignPageHeader title={t('inventoryLedger')} subtitle={lang === 'ar' ? 'سجل كامل لحركات المخزون (منتجات ومواد خام)' : 'Full movement log for inventory (products and raw materials)'} actions={
        <button onClick={handleExport} className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg border border-ui-border hover:bg-ui-page-alt dark:hover:bg-ui-surface text-ui-text transition-all">
          {t('exportExcel')}
        </button>
      } />

      <DesignPanel testId="inventory-ledger-search-panel">
        <div className="flex flex-col sm:flex-row gap-3">
          <DesignSearch value={search} onChange={setSearch} className="flex-1" label={t('search')} placeholder={t('search')} testId="inventory-ledger-search" />
          <Select value={entryType} onChange={(e) => setEntryType(e.target.value)} className="sm:w-48">
            <option value="all">{t('all')}</option>
            {entryTypes.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </Select>
          <Select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="sm:w-48">
            <option value="">{t('allBranches')}</option>
            {branches.map((br) => <option key={br.id} value={br.id}>{br.name}</option>)}
          </Select>
        </div>
      </DesignPanel>

      <DesignPanel testId="inventory-ledger-table-panel">
        <DataTable columns={columns} data={rows} loading={loading} error={error} emptyMessage={t('noData')} />
        <DesignPagination loaded={rows.length} total={total} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} />
      </DesignPanel>
    </DesignSurface>
  );
}