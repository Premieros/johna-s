import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, History } from 'lucide-react';
import { supabase } from '@/api';
import * as api from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { DesignSurface, DesignPageHeader, DesignSearch, DesignPanel } from '@/components/design';
import { DataTable, type Column } from '@/components/DataTable';
import { Button } from '@/components/Button';
import { Select } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { CostBreakdownButton } from '@/features/costing/components/CostBreakdownButton';
import { formatCurrency, formatNumber, formatDate, formatDateTime, formatExactQuantity, formatRawMaterialQuantity, type MeasurementUnitDisplay } from '@/lib/format';
import { exportToExcel } from '@/lib/excel';
import { foodCostPct, marginPct, safeDiv, variancePct } from '@/lib/costing';
import type {
  CostingOverviewRow, OrderMarginRow, SupplierPriceImpactRow, ProductCostingDetail,
  RawMaterialCostOverviewRow, RawMaterialCostHistoryRow, RawMaterialPriceSource,
} from '@/lib/types';

type Tab = 'overview' | 'raw_prices' | 'orders' | 'supplier';
type SalesCostSummary = { sales_count: number; net_sales: number; cogs: number; ratio: number };

export function CostingCenterPage() {
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';
  const { show } = useToast();
  const branchFilter = useBranchFilter();

  const [tab, setTab] = useState<Tab>('overview');
  const [overview, setOverview] = useState<CostingOverviewRow[]>([]);
  const [orders, setOrders] = useState<OrderMarginRow[]>([]);
  const [supplierImpact, setSupplierImpact] = useState<SupplierPriceImpactRow[]>([]);
  const [rawCosts, setRawCosts] = useState<RawMaterialCostOverviewRow[]>([]);
  const [rawHistory, setRawHistory] = useState<RawMaterialCostHistoryRow[]>([]);
  const [rawHistoryTarget, setRawHistoryTarget] = useState<RawMaterialCostOverviewRow | null>(null);
  const [rawHistoryLoading, setRawHistoryLoading] = useState(false);
  const [salesCostSummary, setSalesCostSummary] = useState<SalesCostSummary>({ sales_count: 0, net_sales: 0, cogs: 0, ratio: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [branchId, setBranchId] = useState(branchFilter || '');
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [rawMaterialUnits, setRawMaterialUnits] = useState<Record<string, MeasurementUnitDisplay>>({});
  const [detail, setDetail] = useState<ProductCostingDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadBranches = useCallback(async () => {
    const br = await supabase.from('branches').select('id, name').eq('is_active', true).order('name');
    if (br.error) { show(br.error.message, 'error'); return; }
    const b = (br.data as { id: string; name: string }[] | null) || [];
    setBranches(b);
    if (!branchId && b.length === 1) setBranchId(b[0].id);
  }, [branchId, show]);

  const loadSuppliers = useCallback(async () => {
    const sp = await supabase.from('suppliers').select('id, name').order('name');
    if (sp.error) { show(sp.error.message, 'error'); return; }
    const s = (sp.data as { id: string; name: string }[] | null) || [];
    setSuppliers(s);
    if (s.length > 0) setSupplierId(s[0].id);
  }, [show]);

  const loadRawMaterialUnits = useCallback(async () => {
    const [materialsRes, unitsRes] = await Promise.all([
      supabase.from('raw_materials').select('id, unit_id'),
      supabase.from('measurement_units').select('id, code, name, symbol'),
    ]);
    if (materialsRes.error || unitsRes.error) return;
    const unitsById = new Map<string, MeasurementUnitDisplay>();
    for (const unit of (unitsRes.data || []) as Array<{ id: string; code: string; name: string; symbol: string | null }>) {
      unitsById.set(unit.id, unit);
    }
    const next: Record<string, MeasurementUnitDisplay> = {};
    for (const material of (materialsRes.data || []) as Array<{ id: string; unit_id: string | null }>) {
      if (!material.unit_id) continue;
      const unit = unitsById.get(material.unit_id);
      if (unit) next[material.id] = unit;
    }
    setRawMaterialUnits(next);
  }, []);

  const effBranch = useMemo(() => branchId || null, [branchId]);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [res, summaryRes] = await Promise.all([
      api.costing.getOverview({ p_branch_id: effBranch }),
      api.costing.getSalesSummary({ p_branch_id: effBranch, p_from: null, p_to: null }),
    ]);
    if (res.error) { setError(res.error.message); setLoading(false); show(res.error.message, 'error'); return; }
    setOverview(res.data || []);
    if (!summaryRes.error && summaryRes.data) {
      setSalesCostSummary({
        sales_count: Number(summaryRes.data.sales_count || 0),
        net_sales: Number(summaryRes.data.net_sales || 0),
        cogs: Number(summaryRes.data.cogs || 0),
        ratio: Number(summaryRes.data.ratio || 0),
      });
    } else {
      setSalesCostSummary({ sales_count: 0, net_sales: 0, cogs: 0, ratio: 0 });
    }
    setLoading(false);
  }, [effBranch, show]);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await api.costing.getOrderMargin({ p_branch_id: effBranch, p_from: fromDate || null, p_to: toDate || null });
    if (res.error) { setError(res.error.message); setLoading(false); show(res.error.message, 'error'); return; }
    setOrders(res.data || []);
    setLoading(false);
  }, [effBranch, fromDate, toDate, show]);

  const loadSupplierImpact = useCallback(async () => {
    if (!supplierId) { setSupplierImpact([]); return; }
    setLoading(true);
    setError(null);
    const res = await api.costing.getSupplierPriceImpact({ p_supplier_id: supplierId });
    if (res.error) { setError(res.error.message); setLoading(false); show(res.error.message, 'error'); return; }
    setSupplierImpact(res.data || []);
    setLoading(false);
  }, [supplierId, show]);

  const loadRawCosts = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await api.costing.getRawMaterialCostOverview({ p_branch_id: effBranch });
    if (res.error) {
      setError(res.error.message);
      setLoading(false);
      show(res.error.message, 'error');
      return;
    }
    setRawCosts(res.data || []);
    setLoading(false);
  }, [effBranch, show]);

  const openRawHistory = useCallback(async (row: RawMaterialCostOverviewRow) => {
    setRawHistoryTarget(row);
    setRawHistory([]);
    setRawHistoryLoading(true);
    const res = await api.costing.getRawMaterialCostHistory({
      p_raw_material_id: row.raw_material_id,
      p_branch_id: row.branch_id,
      p_limit: 100,
    });
    setRawHistoryLoading(false);
    if (res.error) {
      show(res.error.message, 'error');
      return;
    }
    setRawHistory(res.data || []);
  }, [show]);

  useEffect(() => { void loadBranches(); }, [loadBranches]);
  useEffect(() => { void loadSuppliers(); }, [loadSuppliers]);
  useEffect(() => { void loadRawMaterialUnits(); }, [loadRawMaterialUnits]);
  useEffect(() => {
    if (tab === 'overview') void loadOverview();
    else if (tab === 'raw_prices') void loadRawCosts();
    else if (tab === 'orders') void loadOrders();
    else void loadSupplierImpact();
  }, [tab, loadOverview, loadRawCosts, loadOrders, loadSupplierImpact]);

  const openDetail = async (productId: string) => {
    setDetailLoading(true);
    const res = await api.costing.getProductDetail({ p_product_id: productId, p_branch_id: effBranch });
    setDetailLoading(false);
    if (res.error) { show(res.error.message, 'error'); return; }
    if (res.data && res.data.success === false) { show(res.data.error || t('error'), 'error'); return; }
    setDetail(res.data || null);
  };

  const filteredOverview = useMemo(() => {
    const q = search.toLowerCase();
    return overview.filter((r) => !q
      || r.product_name.toLowerCase().includes(q)
      || (r.barcode || '').toLowerCase().includes(q)
      || (r.sku || '').toLowerCase().includes(q)
      || (r.category_name || '').toLowerCase().includes(q));
  }, [overview, search]);

  const filteredRawCosts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rawCosts.filter((r) => !q
      || r.raw_material_name.toLowerCase().includes(q)
      || (r.raw_material_code || '').toLowerCase().includes(q)
      || (r.reference_number || '').toLowerCase().includes(q));
  }, [rawCosts, search]);

  const stats = useMemo(() => {
    const count = filteredOverview.length;
    const costedRows = filteredOverview.filter((r) => Number(r.actual_cost || r.theoretical_cost || r.unit_cost || 0) > 0);
    const fc = costedRows.map((r) => foodCostPct(r.actual_cost || r.theoretical_cost || r.unit_cost, r.sale_price));
    const avg = safeDiv(fc.reduce((s, v) => s + v, 0), fc.length);
    const worst = costedRows.reduce<CostingOverviewRow | null>((acc, r) => {
      const v = foodCostPct(r.actual_cost || r.theoretical_cost || r.unit_cost, r.sale_price);
      return !acc || v > foodCostPct(acc.actual_cost || acc.theoretical_cost || acc.unit_cost, acc.sale_price) ? r : acc;
    }, null);
    return { count, avg, worst };
  }, [filteredOverview]);

  const visibleBranches = branchFilter ? branches.filter((b) => b.id === branchFilter) : branches;
  const money = (v: number | undefined | null) => formatCurrency(Number(v || 0), 'EGP', lang);
  const rawUnitMoney = (v: number | undefined | null) => {
    const value = Number(v || 0);
    const decimals = Math.abs(value) > 0 && Math.abs(value) < 1 ? 6 : 2;
    return `${formatNumber(value, decimals)} EGP`;
  };
  const rawUnitLabel = (rawMaterialId: string) => {
    const unit = rawMaterialUnits[rawMaterialId];
    return unit?.symbol || unit?.code || unit?.name || '';
  };
  const pill = (label: string, cls: string) => <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{label}</span>;
  const marginPill = (v: number) => {
    if (v >= 40) return pill(`${formatNumber(v, 1)}%`, 'bg-ui-success-soft text-ui-success dark:text-ui-success');
    if (v >= 20) return pill(`${formatNumber(v, 1)}%`, 'bg-ui-warning-soft text-ui-warning');
    return pill(`${formatNumber(v, 1)}%`, 'bg-ui-danger-soft text-ui-danger');
  };

  const rawPriceSourceLabel = (source: RawMaterialPriceSource | string) => {
    if (source === 'purchase') return isAr ? 'مشتريات' : 'Purchase';
    if (source === 'stock_count') return isAr ? 'جرد' : 'Stock count';
    if (source === 'pricing') return isAr ? 'تسعير' : 'Pricing';
    if (source === 'inventory_average') return isAr ? 'متوسط المخزون' : 'Inventory average';
    if (source === 'batch_average') return isAr ? 'متوسط الدفعات' : 'Batch average';
    return isAr ? 'تكلفة افتراضية' : 'Default cost';
  };

  const rawPriceSourcePill = (source: RawMaterialPriceSource | string) => {
    const cls = source === 'purchase'
      ? 'bg-ui-info-soft text-ui-info'
      : source === 'stock_count'
        ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
        : source === 'pricing'
          ? 'bg-ui-primary-soft text-ui-primary'
          : 'bg-ui-page-alt text-ui-muted';
    return pill(rawPriceSourceLabel(source), cls);
  };

  const overviewColumns: Column<CostingOverviewRow & { id: string }>[] = [
    { key: 'product', header: t('product'), render: (r) => <div className="flex items-center gap-2"><div className="w-8 h-8 rounded-lg bg-ui-page-alt flex items-center justify-center text-xs font-bold text-ui-subtle">{r.product_name[0]}</div><div><p className="font-medium text-ui-text">{r.product_name}</p><p className="text-xs text-ui-subtle">{r.barcode || r.sku || r.category_name || ''}</p></div></div> },
    { key: 'sale', header: t('salePrice'), render: (r) => money(r.sale_price) },
    { key: 'unitCost', header: t('unitCost'), render: (r) => money(r.unit_cost) },
    { key: 'theoretical', header: t('theoreticalCost'), render: (r) => money(r.theoretical_cost) },
    { key: 'actual', header: t('actualCost'), render: (r) => money(r.actual_cost) },
    { key: 'margin', header: t('marginPct'), render: (r) => marginPill(marginPct(r.actual_cost || r.theoretical_cost || r.unit_cost, r.sale_price)) },
    { key: 'variance', header: t('variance'), render: (r) => !r.theoretical_cost && !r.actual_cost ? '-' : <span className="text-xs">{formatNumber(variancePct(r.actual_cost, r.theoretical_cost), 1)}%</span> },
  ];

  const orderColumns: Column<OrderMarginRow & { id: string }>[] = [
    { key: 'invoice', header: t('invoiceNumber'), render: (r) => <span className="font-medium">{r.invoice_number}</span> },
    { key: 'date', header: t('date'), render: (r) => formatDate(r.sale_date, lang) },
    { key: 'total', header: t('total'), render: (r) => money(r.total) },
    { key: 'discount', header: t('discountAmount'), render: (r) => money(r.discount_amount) },
    { key: 'cogs', header: t('unitCost'), render: (r) => money(r.cogs) },
    { key: 'margin', header: t('grossMargin'), render: (r) => <span className={`font-semibold ${r.gross_margin >= 0 ? 'text-ui-success dark:text-ui-success' : 'text-ui-danger'}`}>{money(r.gross_margin)}</span> },
    { key: 'marginPct', header: t('marginPct'), render: (r) => marginPill(marginPct(r.cogs, r.total)) },
  ];

  const supplierColumns: Column<SupplierPriceImpactRow & { id: string }>[] = [
    { key: 'item', header: t('item'), render: (r) => <div><p className="font-medium text-ui-text">{r.item_name}</p><p className="text-xs text-ui-subtle">{r.item_type === 'product' ? t('product') : t('rawMaterial')}</p></div> },
    { key: 'first', header: t('firstCost'), render: (r) => money(r.first_cost) },
    { key: 'last', header: t('lastCost'), render: (r) => money(r.last_cost) },
    { key: 'avg', header: t('avgCost'), render: (r) => money(r.avg_cost) },
    { key: 'change', header: t('changePct'), render: (r) => <span className={`font-semibold ${r.change_pct > 0 ? 'text-ui-danger' : r.change_pct < 0 ? 'text-ui-success dark:text-ui-success' : 'text-ui-muted'}`}>{r.change_pct > 0 ? '+' : ''}{formatNumber(r.change_pct, 1)}%</span> },
    { key: 'count', header: t('purchaseCount'), render: (r) => formatNumber(r.purchase_count, 0) },
    { key: 'lastDate', header: t('lastUpdated'), render: (r) => r.last_purchased_at ? formatDate(r.last_purchased_at, lang) : '-' },
  ];

  const rawCostColumns: Column<RawMaterialCostOverviewRow & { id: string }>[] = [
    { key: 'raw', header: t('rawMaterial'), render: (r) => <div><p className="font-semibold text-ui-text">{r.raw_material_name}</p><p className="text-xs text-ui-subtle">{r.raw_material_code || '-'}</p></div> },
    { key: 'latest', header: isAr ? 'آخر سعر / وحدة المخزون' : 'Latest / stock unit', render: (r) => <div><span className="font-bold text-ui-text">{rawUnitMoney(r.latest_cost)}</span>{rawUnitLabel(r.raw_material_id) && <p className="text-[10px] text-ui-subtle">/ {rawUnitLabel(r.raw_material_id)}</p>}</div> },
    { key: 'previous', header: isAr ? 'السعر السابق' : 'Previous price', render: (r) => r.previous_cost == null ? '-' : rawUnitMoney(r.previous_cost) },
    { key: 'change', header: isAr ? 'التغير' : 'Change', render: (r) => r.change_pct == null ? '-' : <span className={`font-semibold ${r.change_pct > 0 ? 'text-ui-danger' : r.change_pct < 0 ? 'text-ui-success' : 'text-ui-muted'}`}>{r.change_pct > 0 ? '+' : ''}{formatNumber(r.change_pct, 2)}%</span> },
    { key: 'source', header: isAr ? 'مصدر السعر' : 'Price source', render: (r) => rawPriceSourcePill(r.price_source) },
    { key: 'date', header: isAr ? 'تاريخ السعر' : 'Price date', render: (r) => r.priced_at ? formatDateTime(r.priced_at, lang) : '-' },
    { key: 'reference', header: isAr ? 'المرجع' : 'Reference', render: (r) => <div><p className="text-xs font-medium text-ui-text">{r.reference_number || '-'}</p>{r.source_detail && <p className="text-[11px] text-ui-subtle">{r.source_detail}</p>}</div> },
    { key: 'history', header: isAr ? 'التاريخ' : 'History', render: (r) => <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); void openRawHistory(r); }}><History className="w-4 h-4" /> {formatNumber(r.event_count, 0)}</Button> },
  ];

  const rawHistoryColumns: Column<RawMaterialCostHistoryRow & { id: string }>[] = [
    { key: 'date', header: t('date'), render: (r) => formatDateTime(r.priced_at, lang) },
    { key: 'source', header: isAr ? 'المصدر' : 'Source', render: (r) => rawPriceSourcePill(r.price_source) },
    { key: 'cost', header: isAr ? 'السعر' : 'Price', render: (r) => <span className="font-bold text-ui-text">{rawUnitMoney(r.unit_cost)}</span> },
    { key: 'previous', header: isAr ? 'السعر السابق' : 'Previous', render: (r) => r.previous_cost == null ? '-' : rawUnitMoney(r.previous_cost) },
    { key: 'change', header: isAr ? 'التغير' : 'Change', render: (r) => r.change_pct == null ? '-' : <span className={`font-semibold ${r.change_pct > 0 ? 'text-ui-danger' : r.change_pct < 0 ? 'text-ui-success' : 'text-ui-muted'}`}>{r.change_pct > 0 ? '+' : ''}{formatNumber(r.change_pct, 2)}%</span> },
    { key: 'reference', header: isAr ? 'رقم المستند' : 'Document', render: (r) => r.reference_number || '-' },
    { key: 'detail', header: isAr ? 'التوضيح' : 'Details', render: (r) => r.source_detail || '-' },
  ];

  const tabBtn = (key: Tab, label: string) => <button onClick={() => setTab(key)} className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${tab === key ? 'bg-ui-primary text-ui-primary-fg shadow-lg shadow-ui-primary/25 scale-[1.02]' : 'liquid-glass text-ui-text hover:border-ui-primary/40 hover:bg-ui-surface/90'}`}>{label}</button>;

  const handleExportOverview = () => exportToExcel(filteredOverview.map((r) => ({ Product: r.product_name, Barcode: r.barcode || '', SKU: r.sku || '', Category: r.category_name || '', Type: r.product_type, SalePrice: r.sale_price, UnitCost: r.unit_cost, TheoreticalCost: r.theoretical_cost, ActualCost: r.actual_cost })), 'costing-overview');
  const handleExportRawCosts = () => exportToExcel(filteredRawCosts.map((r) => ({ RawMaterial: r.raw_material_name, Code: r.raw_material_code || '', LatestCost: r.latest_cost, PreviousCost: r.previous_cost ?? '', ChangePct: r.change_pct ?? '', Source: rawPriceSourceLabel(r.price_source), PriceDate: r.priced_at || '', Reference: r.reference_number || '', Detail: r.source_detail || '' })), 'raw-material-price-history');
  const handleExportOrders = () => exportToExcel(orders.map((r) => ({ Invoice: r.invoice_number, Date: r.sale_date, Total: r.total, Discount: r.discount_amount, COGS: r.cogs, GrossMargin: r.gross_margin })), 'order-margin');
  const handleExportSupplier = () => exportToExcel(supplierImpact.map((r) => ({ Item: r.item_name, Type: r.item_type, FirstCost: r.first_cost, LastCost: r.last_cost, AvgCost: r.avg_cost, ChangePct: r.change_pct, PurchaseCount: r.purchase_count })), 'supplier-price-impact');

  return (
    <DesignSurface testId="costing-center-page">
      <DesignPageHeader title={t('costingCenter')} subtitle={isAr ? 'تكلفة المنتجات وربحية المبيعات وآخر أسعار الخامات' : 'Product costing, sales margin and latest raw-material prices'} actions={<Button variant="outline" size="sm" onClick={() => { if (tab === 'overview') handleExportOverview(); else if (tab === 'raw_prices') handleExportRawCosts(); else if (tab === 'orders') handleExportOrders(); else handleExportSupplier(); }}><Download className="w-4 h-4" /> {t('exportExcel')}</Button>} />

      <div className="flex gap-1.5 liquid-glass rounded-2xl p-1.5 w-fit mb-4" role="tablist">
        {tabBtn('overview', t('costingOverview'))}
        {tabBtn('raw_prices', isAr ? 'أسعار الخامات' : 'Raw Material Prices')}
        {tabBtn('orders', t('orderMargin'))}
        {tabBtn('supplier', t('supplierImpact'))}
      </div>

      {tab === 'overview' && <>
        <DesignPanel testId="costing-summary-panel">
          <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <div className="rounded-xl border border-ui-border bg-ui-surface/60 p-4 shadow-sm"><p className="text-xs font-medium text-ui-subtle uppercase tracking-wide">{t('product')}</p><p className="mt-1 text-2xl font-bold text-ui-primary">{stats.count}</p></div>
            <div className="rounded-xl border border-ui-border bg-ui-surface/60 p-4 shadow-sm"><p className="text-xs font-medium text-ui-subtle uppercase tracking-wide">{isAr ? 'متوسط تكلفة المنتجات' : 'Average product cost'}</p><p className="mt-1 text-2xl font-bold text-ui-text">{formatNumber(stats.avg, 1)}%</p></div>
            <div className="rounded-xl border border-ui-border bg-ui-surface/60 p-4 shadow-sm"><p className="text-xs font-medium text-ui-subtle uppercase tracking-wide">{isAr ? 'التكلفة الفعلية من المبيعات' : 'Actual COGS / Net Sales'}</p><p className="mt-1 text-2xl font-bold text-ui-text">{formatNumber(salesCostSummary.ratio, 1)}%</p><p className="mt-1 text-[11px] text-ui-subtle">{money(salesCostSummary.cogs)} / {money(salesCostSummary.net_sales)}</p></div>
            <div className="rounded-xl border border-ui-border bg-ui-surface/60 p-4 shadow-sm"><p className="text-xs font-medium text-ui-subtle uppercase tracking-wide">{isAr ? 'أعلى تكلفة نسبة' : 'Highest cost ratio'}</p><p className="mt-1 truncate font-semibold text-ui-text">{stats.worst ? stats.worst.product_name : '-'}</p></div>
          </div>
        </DesignPanel>
        <DesignPanel testId="costing-search-panel"><div className="flex flex-col sm:flex-row gap-3"><DesignSearch value={search} onChange={setSearch} className="flex-1" label={t('search')} placeholder={t('search')} testId="costing-search" /><Select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="sm:w-44"><option value="">{t('allBranches')}</option>{visibleBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></div></DesignPanel>
        <DesignPanel testId="costing-table-panel"><DataTable columns={overviewColumns} data={filteredOverview.map((r) => ({ ...r, id: r.product_id }))} loading={loading} error={error} emptyMessage={t('noData')} onRowClick={(r) => void openDetail(r.product_id)} /></DesignPanel>
      </>}

      {tab === 'raw_prices' && <>
        <DesignPanel testId="raw-material-cost-summary">
          <div className="rounded-xl border border-ui-border bg-ui-page-alt p-4 text-sm text-ui-muted">
            <p className="font-semibold text-ui-text">{isAr ? 'قاعدة احتساب تكلفة الخامة' : 'Raw-material costing rule'}</p>
            <p className="mt-1">
              {isAr
                ? 'يستخدم مركز التكلفة آخر سعر فعلي زمنيًا بين فاتورة شراء مكتملة أو جرد مطبق. سعر الشراء يُحوّل تلقائيًا إلى وحدة تخزين الخامة الأساسية، ولا يتم تغيير منطق تقييم المخزون أو FIFO.'
                : 'Costing uses the latest dated authoritative price from a completed purchase or applied stock count. Purchase prices are normalized to the raw material base stock unit; inventory valuation/FIFO remains unchanged.'}
            </p>
          </div>
        </DesignPanel>
        <DesignPanel testId="raw-material-cost-search">
          <div className="flex flex-col sm:flex-row gap-3">
            <DesignSearch value={search} onChange={setSearch} className="flex-1" label={t('search')} placeholder={isAr ? 'بحث باسم الخامة أو الكود أو المرجع' : 'Search raw material, code or reference'} testId="raw-cost-search" />
            <Select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="sm:w-44"><option value="">{t('allBranches')}</option>{visibleBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
          </div>
        </DesignPanel>
        <DesignPanel testId="raw-material-cost-table">
          <DataTable columns={rawCostColumns} data={filteredRawCosts.map((r) => ({ ...r, id: r.raw_material_id }))} loading={loading} error={error} emptyMessage={t('noData')} onRowClick={(r) => void openRawHistory(r)} />
        </DesignPanel>
      </>}

      {tab === 'orders' && <DesignPanel testId="order-margin-panel">
        <div className="flex flex-col sm:flex-row gap-3 mb-4"><input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="border border-ui-border rounded-lg px-3 py-2 bg-ui-page text-sm" /><input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="border border-ui-border rounded-lg px-3 py-2 bg-ui-page text-sm" /><Select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="sm:w-44"><option value="">{t('allBranches')}</option>{visibleBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select><Button size="sm" onClick={() => void loadOrders()}>{t('search')}</Button></div>
        <DataTable columns={orderColumns} data={orders.map((r) => ({ ...r, id: r.sale_id }))} loading={loading} error={error} emptyMessage={t('noData')} />
      </DesignPanel>}

      {tab === 'supplier' && <DesignPanel testId="supplier-impact-panel">
        <div className="flex flex-col sm:flex-row gap-3 mb-4"><Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="sm:w-72">{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select><Button size="sm" onClick={() => void loadSupplierImpact()}>{t('search')}</Button></div>
        <DataTable columns={supplierColumns} data={supplierImpact.map((r) => ({ ...r, id: `${r.item_type}-${r.item_id}` }))} loading={loading} error={error} emptyMessage={t('noData')} />
      </DesignPanel>}

      <Modal open={rawHistoryTarget !== null} onClose={() => { setRawHistoryTarget(null); setRawHistory([]); }} title={rawHistoryTarget ? `${isAr ? 'تاريخ سعر' : 'Price History'} — ${rawHistoryTarget.raw_material_name}` : ''} size="xl">
        {rawHistoryTarget && <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-ui-border bg-ui-page p-3"><p className="text-xs text-ui-subtle">{isAr ? 'آخر سعر معتمد' : 'Latest authoritative price'}</p><p className="mt-1 text-lg font-bold text-ui-text">{rawUnitMoney(rawHistoryTarget.latest_cost)} {rawUnitLabel(rawHistoryTarget.raw_material_id) ? `/ ${rawUnitLabel(rawHistoryTarget.raw_material_id)}` : ''}</p></div>
            <div className="rounded-xl border border-ui-border bg-ui-page p-3"><p className="text-xs text-ui-subtle">{isAr ? 'المصدر' : 'Source'}</p><div className="mt-2">{rawPriceSourcePill(rawHistoryTarget.price_source)}</div></div>
            <div className="rounded-xl border border-ui-border bg-ui-page p-3"><p className="text-xs text-ui-subtle">{isAr ? 'تاريخ آخر سعر' : 'Latest price date'}</p><p className="mt-1 text-sm font-semibold text-ui-text">{rawHistoryTarget.priced_at ? formatDateTime(rawHistoryTarget.priced_at, lang) : '-'}</p></div>
          </div>
          <p className="text-xs text-ui-subtle">{isAr ? 'السجل التالي يعرض تغيّر سعر الوحدة الأساسية للخامة من المشتريات المكتملة والجرد المطبق فقط، من الأحدث إلى الأقدم.' : 'The timeline below shows base-unit price changes from completed purchases and applied stock counts only, newest first.'}</p>
          <DataTable columns={rawHistoryColumns} data={rawHistory.map((r) => ({ ...r, id: r.event_id }))} loading={rawHistoryLoading} emptyMessage={isAr ? 'لا توجد حركات سعر شراء/جرد مسجلة لهذه الخامة.' : 'No purchase/stock-count price events recorded for this raw material.'} />
        </div>}
      </Modal>

      <Modal open={detail !== null} onClose={() => setDetail(null)} title={detail?.product_name || t('costingCenter')} size="2xl">
        {detailLoading && <p className="text-sm text-ui-subtle">{t('loading')}</p>}
        {!detailLoading && detail && <div className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="rounded-ui-lg border border-ui-border bg-ui-page p-3"><p className="text-xs text-ui-subtle">{t('salePrice')}</p><p className="text-lg font-bold text-ui-text">{money(detail.sale_price)}</p></div>
            <div className="rounded-ui-lg border border-ui-border bg-ui-page p-3"><p className="text-xs text-ui-subtle">{t('unitCost')}</p><p className="text-lg font-bold text-ui-text">{money(detail.unit_cost)}</p></div>
            <div className="rounded-ui-lg border border-ui-border bg-ui-page p-3"><p className="text-xs text-ui-subtle">{t('theoreticalCost')}</p><p className="text-lg font-bold text-ui-text">{money(detail.theoretical_cost)}</p></div>
            <div className="rounded-ui-lg border border-ui-border bg-ui-page p-3"><p className="text-xs text-ui-subtle">{t('actualCost')}</p><p className="text-lg font-bold text-ui-text">{money(detail.actual_cost)}</p></div>
            <div className="rounded-ui-lg border border-ui-border bg-ui-page p-3"><p className="text-xs text-ui-subtle">{t('foodCostPct')}</p><p className="text-lg font-bold text-ui-text">{formatNumber(foodCostPct(detail.actual_cost || detail.theoretical_cost || detail.unit_cost || 0, detail.sale_price || 0), 1)}%</p></div>
            <div className="rounded-ui-lg border border-ui-border bg-ui-page p-3"><p className="text-xs text-ui-subtle">{t('marginPct')}</p><p className="text-lg font-bold text-ui-text">{formatNumber(marginPct(detail.actual_cost || detail.theoretical_cost || detail.unit_cost || 0, detail.sale_price || 0), 1)}%</p></div>
          </div>

          {(detail.components?.length || 0) > 0 && <div>
            <h3 className="text-sm font-bold text-ui-text mb-2">{t('components')}</h3>
            <div className="overflow-x-auto rounded-ui-lg border border-ui-border"><table className="w-full text-sm"><thead><tr className="bg-ui-page-alt text-start text-xs text-ui-subtle"><th className="px-3 py-2">{t('item')}</th><th className="px-3 py-2">{t('quantity')}</th><th className="px-3 py-2">{t('unitCost')}</th><th className="px-3 py-2">{t('total')}</th><th className="px-3 py-2">{isAr ? 'التوضيح' : 'Explanation'}</th></tr></thead><tbody>
              {detail.components!.map((c) => <tr key={c.component_product_id} className="border-t border-ui-border"><td className="px-3 py-2">{c.component_name}</td><td className="px-3 py-2">{formatExactQuantity(c.quantity)}</td><td className="px-3 py-2">{money(c.unit_cost)}</td><td className="px-3 py-2">{money(c.line_cost)}</td><td className="px-3 py-2"><CostBreakdownButton kind="product" itemId={c.component_product_id} itemName={c.component_name} lineQuantity={c.quantity} usedUnitCost={c.unit_cost} lineCost={c.line_cost} branchId={effBranch} /></td></tr>)}
            </tbody></table></div>
          </div>}

          {(detail.recipe_items?.length || 0) > 0 && <div>
            <h3 className="text-sm font-bold text-ui-text mb-2">{t('recipeItems')}</h3>
            <div className="overflow-x-auto rounded-ui-lg border border-ui-border"><table className="w-full text-sm"><thead><tr className="bg-ui-page-alt text-start text-xs text-ui-subtle"><th className="px-3 py-2">{t('item')}</th><th className="px-3 py-2">{t('quantity')}</th><th className="px-3 py-2">{t('wastagePercent')}</th><th className="px-3 py-2">{t('unitCost')}</th><th className="px-3 py-2">{isAr ? 'مصدر السعر' : 'Price source'}</th><th className="px-3 py-2">{isAr ? 'تاريخ السعر' : 'Price date'}</th><th className="px-3 py-2">{t('total')}</th><th className="px-3 py-2">{isAr ? 'التوضيح' : 'Explanation'}</th></tr></thead><tbody>
              {detail.recipe_items!.map((c) => <tr key={c.raw_material_id} className="border-t border-ui-border"><td className="px-3 py-2">{c.raw_material_name}</td><td className="px-3 py-2">{formatRawMaterialQuantity(c.quantity, rawMaterialUnits[c.raw_material_id], { preferGrams: true, lang })}</td><td className="px-3 py-2">{formatNumber(c.wastage_percent, 1)}%</td><td className="px-3 py-2">{rawUnitMoney(c.unit_cost)}{rawUnitLabel(c.raw_material_id) && <p className="text-[10px] text-ui-subtle">/ {rawUnitLabel(c.raw_material_id)}</p>}</td><td className="px-3 py-2">{rawPriceSourcePill(c.cost_source || 'default_cost')}{c.cost_reference && <p className="mt-1 text-[10px] text-ui-subtle">{c.cost_reference}</p>}</td><td className="px-3 py-2 text-xs">{c.cost_priced_at ? formatDateTime(c.cost_priced_at, lang) : '-'}</td><td className="px-3 py-2">{money(c.line_cost)}</td><td className="px-3 py-2"><CostBreakdownButton kind="raw_material" itemId={c.raw_material_id} itemName={c.raw_material_name} lineQuantity={c.quantity} usedUnitCost={c.unit_cost} lineCost={c.line_cost} branchId={effBranch} unit={rawMaterialUnits[c.raw_material_id]} /></td></tr>)}
            </tbody></table></div>
          </div>}

          {(detail.history?.length || 0) > 0 && <div>
            <h3 className="text-sm font-bold text-ui-text mb-2">{t('costHistory')}</h3>
            <div className="overflow-x-auto rounded-ui-lg border border-ui-border"><table className="w-full text-sm"><thead><tr className="bg-ui-page-alt text-start text-xs text-ui-subtle"><th className="px-3 py-2">{t('date')}</th><th className="px-3 py-2">{t('oldCost')}</th><th className="px-3 py-2">{t('newCost')}</th><th className="px-3 py-2">{t('changedBy')}</th></tr></thead><tbody>
              {detail.history!.map((h) => <tr key={h.id} className="border-t border-ui-border"><td className="px-3 py-2">{formatDateTime(h.changed_at, lang)}</td><td className="px-3 py-2">{money(h.old_cost)}</td><td className="px-3 py-2">{money(h.new_cost)}</td><td className="px-3 py-2">{h.changed_by || '-'}</td></tr>)}
            </tbody></table></div>
          </div>}
        </div>}
      </Modal>
    </DesignSurface>
  );
}
