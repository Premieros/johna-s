import { readReportBranches } from '../services/readReportBranches';
import { clearReportRequestCache } from '@/lib/reportRequestCache';
import { useReportPermissionVersion } from '@/hooks/useReportPermissionVersion';
import { requireReportData } from '../services/reportResult';
import { MAX_REPORT_SOURCE_ROWS } from '../reportReadLimits';
import { createReportSourceCache } from '../reportSourceCache';
import { ReportWorkbench } from '../ReportWorkbench';
import { orderReportColumns } from '../reportColumnLayout';
import { loadProductSalesSummary } from '../services/productSalesReport';
import { loadStationSalesLines } from '../services/stationSalesReport';
import { expenseAccountLabel } from '../utils/expenseAccountLabel';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLatestRead } from '@/hooks/useLatestRead';
import { userFacingErrorMessage } from '@/lib/userFacingError';
import { useAuth } from '@/context/AuthContext';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Download, TrendingUp, ShoppingCart, Receipt, Package, BarChart3, CreditCard, Users, List, Layers, AlertTriangle, FileDown, Printer, UserCheck, RotateCcw, Trash2 } from 'lucide-react';
import { costing, reporting } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { PageHeader, Card } from '@/components/PageHeader';
import { Button } from '@/components/Button';
import { formatFinancialCurrency, formatDate, formatPercent, todayISO } from '@/lib/format';
import { reportDateRangeUtc } from '@/lib/businessTime';
import { exportToExcelAdvanced } from '@/lib/excel';
import { downloadCSV, openPrintWindow } from '@/lib/reportExport';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useCan } from '@/lib/permissions';
import { useHistoryAccess } from '@/lib/useHistoryAccess';
import { useColumnPreferences } from '../useColumnPreferences';
import { ColumnPicker } from '../ColumnPicker';
import { useCustomReports } from '../useCustomReports';
import { getReportExcelProfile } from '../reportExcelProfiles';
import type { SavedReportConfig } from '../useCustomReports';
import { CustomReportBar } from '../CustomReportBar';
import { ReportFilterBar } from '../ReportFilterBar';
import { EMPTY_REPORT_FILTER_OPTIONS, useReportFilterOptions } from '../useReportFilterOptions';
import { loadExpenseReportRows, loadPurchaseReportRows, loadSalesReportRows, loadOperationalReportPage } from '../services/reportCoreLoaders';
import { loadCashierPerformanceRows, loadDetailedInvoiceRows, loadReturnRows, loadSalesByEmployeeRows } from '../services/reportSalesLoaders';
import { loadComponentConsumptionRows, loadInventoryBatchRows, loadLowStockSources, loadProductBranchRows, loadTopConsumedComponentRows, loadTopConsumedProductItems, loadWasteRows } from '../services/reportInventoryLoaders';
import { useBranches } from '@/hooks/useBranches';
import { useSettings } from '@/context/SettingsContext';
import {
  REPORT_FILTER_DIMS,
  DATE_DRIVEN_REPORTS,
  ORDER_TYPE_OPTIONS,
  PAYMENT_METHOD_OPTIONS,
  SALE_STATUS_OPTIONS,
  type ReportFilters,
  type ReportFilterKey,
  type ReportType,
} from '../reportFilters';
import {
  netPurchaseAmount,
  netSaleAmount,
  netSaleItemQuantity,
  netSalePayment,
} from '../numericIntegrity';

const EMPTY_REPORT_ROWS: Record<string, unknown>[] = [];
interface ReportSnapshot { rows: Record<string, unknown>[]; summary: { total: number; count: number }; serverPaged?: boolean; from?: string; to?: string; metrics?: Record<string, number>; }

type FinancialReportType = 'trial_balance' | 'ledger' | 'treasury_statement' | 'inventory_movement' | 'income' | 'balance_sheet' | 'ar_aging' | 'ap_aging' | 'aging_summary' | 'cash_flow' | 'party_statement';
type PeriodKey = 'custom' | 'today' | 'yesterday' | 'last7' | 'last30' | 'this_month' | 'last_month' | 'this_year';

interface ReportsPageProps {
  controlledReportType?: ReportType;
  workspaceTitle?: string;
  onReportTypeChange?: (type: ReportType) => void;
}

export function ReportsPage({ controlledReportType, onReportTypeChange, workspaceTitle }: ReportsPageProps = {}) {
  /* REPORT-BRANCH-AUDIT-2026 */
  const { t, lang } = useLanguage();
  const can = useCan();
  const canStationCost = can('reports.costing');
  const canStationView = can('reports.view');
  const { user } = useAuth();
  const history = useHistoryAccess();
  const navigate = useNavigate();
  const [reportParams] = useSearchParams();
  const branchFilter = useBranchFilter();
  const [reportType, setReportType] = useState<ReportType>(controlledReportType || 'sales');
  const [from, setFrom] = useState(() => reportParams.get('from')?.match(/^\d{4}-\d{2}-\d{2}$/)?.[0] || todayISO());
  const [to, setTo] = useState(() => reportParams.get('to')?.match(/^\d{4}-\d{2}-\d{2}$/)?.[0] || todayISO());
  const [period, setPeriod] = useState<PeriodKey>('custom');
  const [resultView, setResultView] = useState({ source: EMPTY_REPORT_ROWS, page: 0 });
  const [filters, setFilters] = useState<ReportFilters>({});
  const [filtersDirty, setFiltersDirty] = useState(false);
  const [queryVersion, setQueryVersion] = useState(0);
  // The expensive FIFO movement reconciliation is deliberately opt-in per requested report.
  const [includeActualCost, setIncludeActualCost] = useState(false);
  const [requestedScope, setRequestedScope] = useState<string | null>(null);
  const permissionVersion = useReportPermissionVersion();
  const reportScope = JSON.stringify([permissionVersion, reportType, branchFilter, user?.id, user?.role, history.unlimited, lang, canStationCost, canStationView]);

  useEffect(() => {
    if (controlledReportType) {
      setReportType((prev) => {
        if (prev !== controlledReportType) {
          setFilters({});
          setFiltersDirty(false);
          setIncludeActualCost(false);
          onReportTypeChange?.(controlledReportType);
          return controlledReportType;
        }
        return prev;
      });
    }
  }, [controlledReportType, onReportTypeChange]);

  const effectiveBranchFilter = branchFilter;
  // UUID/category selections belong to the old branch/user scope. Clear them
  // before paint and before the deferred report read; keep semantic filters.
  const filterScope = useRef({ branchId: effectiveBranchFilter, userId: user?.id, canStationCost, canStationView });
  useLayoutEffect(() => {
    if (filterScope.current.branchId === effectiveBranchFilter && filterScope.current.userId === user?.id && filterScope.current.canStationCost === canStationCost && filterScope.current.canStationView === canStationView) return;
    filterScope.current = { branchId: effectiveBranchFilter, userId: user?.id, canStationCost, canStationView };
    setFilters(({ order_type, payment_method, status }) => ({ order_type, payment_method, status }));
    setFiltersDirty(false);
    setIncludeActualCost(false);
    setQueryVersion((version) => version + 1);
  }, [effectiveBranchFilter, user?.id, canStationCost, canStationView]);
  const { branches } = useBranches();
  // Equivalent lookup refreshes must not invalidate complete report data.
  const branchSourceKey = JSON.stringify(branches.map(({ id, name, name_en }) => [id, name, name_en]));
  const { data: scopedOptions, error: optionsError, reload: retryOptions } = useReportFilterOptions(reportType, effectiveBranchFilter, user?.id);
  const options = scopedOptions || EMPTY_REPORT_FILTER_OPTIONS;
  const branchColumn = lang === 'ar' ? 'الفرع' : 'Branch';
  const branchNameById = (branchId: unknown): string => {
    const id = typeof branchId === 'string' ? branchId : '';
    const branch = branches.find((item) => item.id === id);
    return (lang === 'ar' ? branch?.name : (branch?.name_en || branch?.name)) || (lang === 'ar' ? 'فرع غير معروف' : 'Unknown branch');
  };
  const withBranch = (branchId: unknown, row: Record<string, unknown>): Record<string, unknown> => ({
    ...row,
    [branchColumn]: branchNameById(branchId),
  });
  const rawDebtStatusLabel = (status: unknown): string => {
    const key = String(status || 'OK');
    const ar: Record<string, string> = {
      OK: 'سليم',
      OUTSTANDING: 'دين غير مسوّى',
      NO_RECEIPT_HISTORY: 'لا يوجد توريد شراء',
      UNPRICED: 'دين بلا سعر',
      UNPRICED_NO_RECEIPT: 'دين بلا سعر ولا توريد شراء',
    };
    const en: Record<string, string> = {
      OK: 'OK',
      OUTSTANDING: 'Outstanding debt',
      NO_RECEIPT_HISTORY: 'No purchase receipt history',
      UNPRICED: 'Unpriced debt',
      UNPRICED_NO_RECEIPT: 'Unpriced debt / no purchase receipt',
    };
    return (lang === 'ar' ? ar : en)[key] || key;
  };
  const { effectiveSettings } = useSettings();
  const currency = effectiveSettings(effectiveBranchFilter)?.currency || 'EGP';
  const { visibleColumns, toggleColumn, showAllColumns, columnOrder, moveColumn, resetColumnOrder } = useColumnPreferences(reportType);
  const { savedReports, saveReport, deleteReport } = useCustomReports();
  const reportBranchLabel = effectiveBranchFilter
    ? branchNameById(effectiveBranchFilter)
    : (lang === 'ar' ? 'كل الفروع المتاحة' : 'All accessible branches');

  const financialTypes: { key: FinancialReportType; label: string }[] = [
    { key: 'trial_balance', label: t('trialBalance') },
    { key: 'ledger', label: t('generalLedger') },
    { key: 'treasury_statement', label: lang === 'ar' ? 'كشف حساب بنك / خزنة' : 'Bank / Treasury Statement' },
    { key: 'inventory_movement', label: lang === 'ar' ? 'حركة صنف' : 'Item Movement' },
    { key: 'income', label: t('incomeStatement') },
    { key: 'balance_sheet', label: t('balanceSheet') },
    { key: 'ar_aging', label: t('arAging') },
    { key: 'ap_aging', label: t('apAging') },
    { key: 'aging_summary', label: t('agingSummary') },
    { key: 'cash_flow', label: t('cashFlow') },
    { key: 'party_statement', label: t('partyStatement') },
  ];
  const canFinancial = can('reports.financial');

  function handleReportTypeSelect(value: string) {
    if (financialTypes.some((f) => f.key === value)) {
      const allowed = history.clampRange(from, to);
      navigate(`/reports?section=financial&view=${value}&from=${allowed.from}&to=${allowed.to}`);
      return;
    }
    setFilters({});
    setFiltersDirty(false);
    setIncludeActualCost(false);
    setReportType(value as ReportType);
    onReportTypeChange?.(value as ReportType);
  }

  const handleSaveCustomReport = () => {
    const name = prompt(lang === 'ar' ? 'اسم التقرير:' : 'Report name:');
    if (!name?.trim()) return;
    saveReport(name.trim(), reportType, visibleColumns, filters);
  };

  const handleRestoreCustomReport = (config: SavedReportConfig) => {
    handleReportTypeSelect(config.reportType);
    setFilters(config.filters || {});
    setFiltersDirty(true);
  };

  const runReport = (refresh = false) => {
    if (refresh) clearReportRequestCache();
    setIncludeActualCost(false);
    setRequestedScope(reportScope);
    const allowed = history.clampRange(from, to);
    const next = new URLSearchParams(reportParams);
    next.set('from', reportType === 'inventory_as_of' ? allowed.to : allowed.from);
    next.set('to', allowed.to);
    navigate(`/reports?${next}`, { replace: true });
    setFiltersDirty(false);
    setQueryVersion((version) => version + 1);
  };

  function applyPeriod(key: PeriodKey) {
    const now = new Date();
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const today = iso(now);
    let f = from;
    let targetTo = today;
    if (key === 'today') f = today;
    else if (key === 'yesterday') {
      const y = new Date(now.getTime() - 86400000);
      f = iso(y);
      targetTo = f;
    } else if (key === 'last7') f = iso(new Date(now.getTime() - 6 * 86400000));
    else if (key === 'last30') f = iso(new Date(now.getTime() - 29 * 86400000));
    else if (key === 'this_month') f = iso(new Date(now.getFullYear(), now.getMonth(), 1));
    else if (key === 'last_month') {
      f = iso(new Date(now.getFullYear(), now.getMonth() - 1, 1));
      targetTo = iso(new Date(now.getFullYear(), now.getMonth(), 0));
    } else if (key === 'this_year') f = iso(new Date(now.getFullYear(), 0, 1));
    const allowed = history.clampRange(f, targetTo);
    setPeriod(key);
    setFrom(allowed.from);
    setTo(allowed.to);
    setFiltersDirty(true);
  }

  // Capture drafts on Run report; an unopened scope remains idle.
  const reportReader = useMemo(() => loadReport,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reportType, effectiveBranchFilter, branchSourceKey, history.unlimited, queryVersion, includeActualCost, user?.id, user?.role, permissionVersion, lang]);
  const [serverView, setServerView] = useState<{ reader: typeof reportReader | null; page: number }>({ reader: null, page: 0 });
  const serverPage = serverView.reader === reportReader ? serverView.page : 0;
  const readReport = useMemo(() => (signal?: AbortSignal) => reportReader(serverPage, false, signal), [reportReader, serverPage]);
  const { data: snapshot, error: reportError, loading, reload: retryReport } = useLatestRead(readReport, 0, requestedScope === reportScope);
  const reportSource = useMemo(() => createReportSourceCache((signal, range) => reportReader(0, true, signal, range)), [reportReader]);
  useEffect(() => () => reportSource.dispose(), [reportSource]);
  const metricSource = useMemo(() => createReportSourceCache((signal, range) => reportReader(0, true, signal, range, true)), [reportReader]);
  useEffect(() => () => metricSource.dispose(), [metricSource]);
  const [workbenchScope, setWorkbenchScope] = useState<unknown>(null);
  const workbenchActive = workbenchScope === reportReader;
  const data = snapshot?.rows || EMPTY_REPORT_ROWS;
  const summary = snapshot?.summary || { total: 0, count: 0 };
  const rowCount = snapshot?.serverPaged ? summary.count : data.length;
  const resultPageCount = Math.max(1, Math.ceil(rowCount / 100));
  const currentResultPage = snapshot?.serverPaged ? serverPage : resultView.source === data ? Math.min(resultView.page, resultPageCount - 1) : 0;
  const resultPageStart = currentResultPage * 100;
  const displayedRows = snapshot?.serverPaged ? data : data.slice(resultPageStart, resultPageStart + 100);
  const changePage = (page: number) => snapshot?.serverPaged
    ? setServerView({ reader: reportReader, page }) : setResultView({ source: data, page });
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);
  const exportGeneration = useRef(0);
  const exportController = useRef<AbortController | null>(null);
  const exportingRef = useRef(false);
  useLayoutEffect(() => {
    exportController.current?.abort();
    const generation = ++exportGeneration.current;
    exportingRef.current = false;
    setExporting(false); setExportError(null);
    return () => { exportGeneration.current = generation + 1; exportController.current?.abort(); };
  }, [reportReader]);

  async function loadReport(page = 0, full = false, signal?: AbortSignal, range?: { from: string; to: string }, metricsOnly = false): Promise<ReportSnapshot> {
    let resultRows: Record<string, unknown>[] = [];
    let resultSummary = { total: 0, count: 0 };
    const setData = (rows: Record<string, unknown>[]) => { resultRows = rows; };
    const setSummary = (value: { total: number; count: number }) => { resultSummary = value; };
    // Chart values were previously retained in unused state; preserve calculations here.
    const setChartData = (value: { name: string; value: number }[]) => { void value; };
    if (!user?.id) return { rows: resultRows, summary: resultSummary };
    const selectedTo = range?.to || to;
    const allowed = history.clampRange(reportType === 'inventory_as_of' ? selectedTo : range?.from || from, selectedTo);
    if (range && (allowed.from !== range.from || allowed.to !== range.to)) throw new Error('COMPARISON_HISTORY_UNAVAILABLE');
    if (!range && reportType !== 'inventory_as_of' && allowed.from !== from) setFrom(allowed.from);
    if (!range && allowed.to !== to) setTo(allowed.to);
    const { startIso: fromTs, endExclusiveIso: toExclusiveTs } = reportDateRangeUtc(allowed.from, allowed.to);

    if (metricsOnly && (reportType === 'sales' || reportType === 'purchases' || reportType === 'expenses')) {
      const result = await reporting.getOperationalReportMetrics({ p_report_type: reportType, p_branch_id: effectiveBranchFilter || null,
        p_from_date: allowed.from, p_to_date: allowed.to, p_filters: { ...filters }, p_from_ts: fromTs, p_to_exclusive_ts: toExclusiveTs }, signal);
      if (result.error) throw new Error(result.error.message || 'REPORT_METRICS_LOAD_FAILED');
      if (!result.data) throw new Error('REPORT_METRICS_INVALID');
      return { rows: [], summary: { total: 0, count: 0 }, metrics: result.data };
    }

    const corePage = !full && (reportType === 'sales' || reportType === 'purchases' || reportType === 'expenses')
      ? await loadOperationalReportPage({ reportType, branchId: effectiveBranchFilter || null,
        from: allowed.from, to: allowed.to, fromTs, toExclusiveTs, filters, page }) : null;

    if (reportType === 'sales_by_station' || reportType === 'sales_costs') {
      if (!canStationView) throw new Error('PERMISSION_DENIED:reports.view');
      if (reportType === 'sales_costs' && !canStationCost) throw new Error('PERMISSION_DENIED:reports.costing');
      const includeCost = canStationCost;
      const lines = await loadStationSalesLines({ branchId: effectiveBranchFilter || null, from: allowed.from, to: allowed.to, fromTs, toExclusiveTs, filters, lang, includeCost, costMode: includeActualCost ? 'actual' : 'estimated', signal });
      const label = (ar: string, en: string) => lang === 'ar' ? ar : en;
      if (reportType === 'sales_costs') {
        setData(lines.map(line => withBranch(line.sale.branch_id, {
          [label('الفاتورة', 'Invoice')]: line.sale.invoice_number,
          [label('التاريخ', 'Date')]: formatDate(line.sale.created_at, lang),
          [label('المنتج', 'Product')]: line.item.product?.name || label('منتج غير متاح', 'Unavailable product'),
          [label('الوحدة', 'Unit')]: line.item.unit_name,
          [label('المحطة', 'Station')]: line.station,
          [label('التصنيف', 'Category')]: line.category,
          [label('صافي الكمية', 'Net Quantity')]: line.netQuantity,
          [label('صافي الإيراد دون الضريبة', 'Net Revenue Excluding Tax')]: line.netBeforeTax,
          [label('تكلفة المباع بالأسعار الحالية', 'Current-price Sold Cost')]: line.estimatedCost ?? line.knownEstimatedCost ?? '—',
          [label('تكلفة المكونات المسعرة فقط', 'Priced Components Only')]: line.knownEstimatedCost ?? label('غير متاحة', 'Unavailable'),
          [label('مجمل الربح بالأسعار الحالية', 'Current-price Gross Profit')]: line.estimatedCost === null ? label('غير متاح', 'Unavailable') : line.netBeforeTax - line.estimatedCost,
          ...(includeActualCost ? {
            [label('التكلفة المسجلة', 'Recorded Cost')]: line.cost ?? label('غير متاحة', 'Unavailable'),
            [label('مجمل الربح المسجل', 'Recorded Gross Profit')]: line.cost === null ? label('غير متاح', 'Unavailable') : line.netBeforeTax - line.cost,
          } : {}),
          [label('خامات غير مسعرة', 'Unpriced Materials')]: line.unpricedMaterials.join('، '),
        })));
      } else setData(lines.map(line => withBranch(line.sale.branch_id, {
        [label('الفاتورة', 'Invoice')]: line.sale.invoice_number,
        [label('التاريخ', 'Date')]: formatDate(line.sale.created_at),
        [label('المحطة', 'Station')]: line.station,
        [label('التصنيف', 'Category')]: line.category,
        [label('المنتج', 'Product')]: line.item.product?.name || label('منتج غير متاح', 'Unavailable product'),
        [label('الوحدة', 'Unit')]: line.item.unit_name,
        [label('نوع الطلب', 'Order Type')]: orderTypeLabels[line.sale.order_type] || line.sale.order_type,
        [label('أمين الصندوق', 'Cashier')]: line.sale.cashier?.full_name || '',
        [label('العميل', 'Customer')]: line.sale.customer?.name || '',
        [label('طريقة الدفع', 'Payment Method')]: paymentMethodLabels[line.sale.payment_method] || line.sale.payment_method,
        [label('الكمية المباعة', 'Sold Quantity')]: Number(line.item.quantity),
        [label('الكمية المرتجعة', 'Returned Quantity')]: Number(line.item.refunded_quantity || 0),
        [label('صافي الكمية', 'Net Quantity')]: line.netQuantity,
        [label('سعر الوحدة', 'Unit Price')]: Number(line.item.unit_price),
        [label('المبيعات قبل الخصم', 'Gross Sales')]: line.gross,
        [label('الخصم الموزع', 'Allocated Discount')]: line.discount,
        [label('الضريبة الموزعة', 'Allocated Tax')]: line.tax,
        [label('الإجمالي الأصلي', 'Original Total')]: line.original,
        [label('قيمة المرتجع', 'Return Value')]: line.refunded,
        [label('صافي الإيراد دون الضريبة', 'Net Revenue Excluding Tax')]: line.netBeforeTax,
        [label('صافي المبيعات', 'Net Sales')]: line.net,
        ...(includeCost ? {
          ...(includeActualCost ? {
            [label('التكلفة المسجلة', 'Recorded Cost')]: line.cost ?? label('غير متاحة', 'Unavailable'),
            [label('مجمل الربح', 'Gross Profit')]: line.cost === null ? label('غير متاح', 'Unavailable') : line.netBeforeTax - line.cost,
            [label('هامش الربح %', 'Profit Margin %')]: line.cost === null || !line.netBeforeTax ? label('غير متاح', 'Unavailable') : Number(((line.netBeforeTax - line.cost) / line.netBeforeTax * 100).toFixed(2)),
          } : {}),
          [label('تكلفة بآخر سعر (تقديرية)', 'Latest Price Cost (Estimated)')]: line.estimatedCost ?? line.knownEstimatedCost ?? '—',
          [label('تكلفة المكونات المسعرة (تقديرية)', 'Priced Components Cost (Estimated)')]: line.knownEstimatedCost ?? label('غير متاحة', 'Unavailable'),
          [label('خامات غير مسعرة', 'Unpriced Materials')]: line.unpricedMaterials.join('، '),
        } : {}),
      })));
      setSummary({ total: lines.reduce((sum, line) => sum + (reportType === 'sales_costs' ? line.netBeforeTax : line.net), 0), count: lines.length });
    } else if (reportType === 'sales') {
      const sales = corePage?.rows ?? await loadSalesReportRows({
        from: allowed.from, to: allowed.to,
        branchId: effectiveBranchFilter || null,
        fromTs,
        toExclusiveTs,
        filters, signal,
      });
      const rows = sales.map((sale: Record<string, unknown>) => {
        const cashier = sale.cashier as { full_name?: string; email?: string } | null;
        const warehouse = sale.warehouse as { name?: string } | null;
        return withBranch(sale.branch_id, {
          [lang === 'ar' ? 'الفاتورة' : 'Invoice']: sale.invoice_number,
          [lang === 'ar' ? 'التاريخ' : 'Date']: formatDate(sale.created_at as string, lang),
          [lang === 'ar' ? 'العميل' : 'Customer']: (sale.customer as { name?: string })?.name || '',
          [lang === 'ar' ? 'المستخدم' : 'User']: cashier?.full_name || cashier?.email || '',
          [lang === 'ar' ? 'المخزن' : 'Warehouse']: warehouse?.name || '',
          [lang === 'ar' ? 'نوع الطلب' : 'Order Type']: orderTypeLabels[String(sale.order_type)] || sale.order_type || '',
          [lang === 'ar' ? 'طريقة الدفع' : 'Payment Method']: paymentMethodLabels[String(sale.payment_method)] || sale.payment_method || '',
          [lang === 'ar' ? 'الحالة' : 'Status']: statusLabels[String(sale.status)] || sale.status || '',
          [lang === 'ar' ? 'قبل الخصم والضريبة' : 'Subtotal']: Number(sale.subtotal || 0),
          [lang === 'ar' ? 'الخصم' : 'Discount']: Number(sale.discount_amount || 0),
          [lang === 'ar' ? 'الضريبة' : 'Tax']: Number(sale.tax_amount || 0),
          [lang === 'ar' ? 'إجمالي الفاتورة' : 'Invoice Total']: Number(sale.total || 0),
          [lang === 'ar' ? 'المدفوع' : 'Paid']: Number(sale.paid_amount || 0),
          [lang === 'ar' ? 'المرتجع' : 'Refunded']: Number(sale.refunded_amount || 0),
          [lang === 'ar' ? 'صافي المبيعات' : 'Net Sales']: netSaleAmount(sale),
          [lang === 'ar' ? 'صافي التحصيل' : 'Net Collection']: netSalePayment(sale),
        });
      });
      setData(rows);
      setChartData(sales.slice(0, 10).map((sale: Record<string, unknown>) => ({ name: String(sale.invoice_number), value: netSaleAmount(sale) })));
      setSummary({ total: sales.reduce((sum: number, sale: Record<string, unknown>) => sum + netSaleAmount(sale), 0), count: sales.length });
    } else if (reportType === 'purchases') {
      const purchases = corePage?.rows ?? await loadPurchaseReportRows({
        from: allowed.from, to: allowed.to,
        branchId: effectiveBranchFilter || null,
        fromTs,
        toExclusiveTs,
        filters, signal,
      });
      const rows = purchases.map((purchase: Record<string, unknown>) => withBranch(purchase.branch_id, {
        [lang === 'ar' ? 'الفاتورة' : 'Invoice']: purchase.invoice_number,
        [lang === 'ar' ? 'التاريخ' : 'Date']: formatDate(purchase.created_at as string, lang),
        [lang === 'ar' ? 'المورد' : 'Supplier']: (purchase.supplier as { name?: string })?.name || '',
        [lang === 'ar' ? 'الإجمالي الأصلي' : 'Original Total']: Number(purchase.total || 0),
        [lang === 'ar' ? 'مرتجع المشتريات' : 'Returned']: Number(purchase.returned_amount || 0),
        [lang === 'ar' ? 'صافي المشتريات' : 'Net Purchases']: netPurchaseAmount(purchase),
      }));
      setData(rows);
      setChartData(purchases.slice(0, 10).map((purchase: Record<string, unknown>) => ({ name: String(purchase.invoice_number), value: netPurchaseAmount(purchase) })));
      setSummary({ total: purchases.reduce((sum: number, purchase: Record<string, unknown>) => sum + netPurchaseAmount(purchase), 0), count: purchases.length });
    } else if (reportType === 'expenses') {
      const expenses = corePage?.rows ?? await loadExpenseReportRows({
        fromTs, toExclusiveTs,
        branchId: effectiveBranchFilter || null,
        from: allowed.from,
        to: allowed.to,
        filters, signal,
      });
      const rows = expenses.map((expense: Record<string, unknown>) => withBranch(expense.branch_id, {
        [lang === 'ar' ? 'التاريخ' : 'Date']: formatDate(expense.expense_date as string, lang),
        [lang === 'ar' ? 'الفئة' : 'Category']: expense.category || '',
        [lang === 'ar' ? 'حساب المصروف' : 'Expense account']: expenseAccountLabel(expense, lang),
        [lang === 'ar' ? 'الوصف' : 'Description']: expense.description || '',
        [lang === 'ar' ? 'المبلغ' : 'Amount']: Number(expense.amount || 0),
      }));
      setData(rows);
      const catMap = new Map<string, number>();
      expenses.forEach((expense: Record<string, unknown>) => catMap.set(String(expense.category || ''), (catMap.get(String(expense.category || '')) || 0) + Number(expense.amount || 0)));
      setChartData(Array.from(catMap.entries()).map(([name, value]) => ({ name: name || (lang === 'ar' ? 'غير محدد' : 'Other'), value })));
      setSummary({ total: expenses.reduce((sum: number, expense: Record<string, unknown>) => sum + Number(expense.amount || 0), 0), count: expenses.length });
    } else if (reportType === 'profit') {
      const targetBranches = effectiveBranchFilter
        ? branches.filter((branch) => branch.id === effectiveBranchFilter)
        : branches;
      const results = await readReportBranches(targetBranches, async (branch) => {
        const { data: statement, error } = await reporting.getIncomeStatement({ p_branch_id: branch.id, p_from_date: allowed.from, p_to_date: allowed.to });
        if (error) throw error;
        return { branch, statement };
      }, signal);
      const rows = results.map(({ branch, statement }) => withBranch(branch.id, {
        [lang === 'ar' ? 'الفترة' : 'Period']: `${allowed.from} - ${allowed.to}`,
        [lang === 'ar' ? 'صافي الإيراد' : 'Net Revenue']: Number(statement?.net_revenue || 0),
        [lang === 'ar' ? 'تكلفة البضاعة المباعة' : 'COGS']: Number(statement?.cogs || 0),
        [lang === 'ar' ? 'مجمل الربح' : 'Gross Profit']: Number(statement?.gross_profit || 0),
        [lang === 'ar' ? 'المصروفات' : 'Expenses']: Number(statement?.expenses || 0),
        [lang === 'ar' ? 'صافي الربح' : 'Net Profit']: Number(statement?.net_income || 0),
      }));
      const netProfit = results.reduce((sum, row) => sum + Number(row.statement?.net_income || 0), 0);
      setData(rows);
      setChartData(rows.map((row) => ({ name: String(row[branchColumn]), value: Number(row[lang === 'ar' ? 'صافي الربح' : 'Net Profit'] || 0) })));
      setSummary({ total: netProfit, count: rows.length });
    } else if (reportType === 'inventory') {
      const { rawRows, unitRows } = await loadInventoryBatchRows({
        branchId: effectiveBranchFilter || null,
        warehouseId: filters.warehouse, signal,
      });
      const stockMap = new Map<string, { branchId: string; warehouse: string; item: string; code: string; type: string; quantity: number }>();
      rawRows.forEach((row: Record<string, unknown>) => {
        const material = row.raw_material as { id?: string; name?: string; code?: string } | null;
        const warehouse = row.warehouse as { name?: string } | null;
        const branchId = String(row.branch_id || '');
        const warehouseId = String(row.warehouse_id || '');
        const itemId = String(material?.id || row.raw_material_id || '');
        const key = `raw:${branchId}:${warehouseId}:${itemId}`;
        const current = stockMap.get(key) || {
          branchId,
          warehouse: warehouse?.name || '-',
          item: material?.name || '-',
          code: material?.code || '',
          type: lang === 'ar' ? 'خامة' : 'Raw material',
          quantity: 0,
        };
        current.quantity += Number(row.quantity || 0);
        stockMap.set(key, current);
      });
      unitRows.forEach((row: Record<string, unknown>) => {
        const unit = row.unit as { id?: string; name?: string; barcode?: string } | null;
        const warehouse = row.warehouse as { name?: string } | null;
        const branchId = String(row.branch_id || '');
        const warehouseId = String(row.warehouse_id || '');
        const itemId = String(unit?.id || row.unit_id || '');
        const key = `unit:${branchId}:${warehouseId}:${itemId}`;
        const current = stockMap.get(key) || {
          branchId,
          warehouse: warehouse?.name || '-',
          item: unit?.name || '-',
          code: unit?.barcode || '',
          type: lang === 'ar' ? 'وحدة مخزون' : 'Inventory unit',
          quantity: 0,
        };
        current.quantity += Number(row.quantity || 0);
        stockMap.set(key, current);
      });
      const rows = Array.from(stockMap.values())
        .sort((a, b) => a.item.localeCompare(b.item))
        .map((row) => withBranch(row.branchId, {
          [lang === 'ar' ? 'الصنف' : 'Item']: row.item,
          [lang === 'ar' ? 'النوع' : 'Type']: row.type,
          [lang === 'ar' ? 'الكود' : 'Code']: row.code,
          [lang === 'ar' ? 'المستودع' : 'Warehouse']: row.warehouse,
          [lang === 'ar' ? 'الكمية' : 'Quantity']: row.quantity,
        }));
      setData(rows);
      setChartData(rows.slice(0, 10).map((row) => ({ name: String(row[lang === 'ar' ? 'الصنف' : 'Item']), value: Number(row[lang === 'ar' ? 'الكمية' : 'Quantity']) })));
      setSummary({ total: rows.reduce((sum, row) => sum + Number(row[lang === 'ar' ? 'الكمية' : 'Quantity'] || 0), 0), count: rows.length });
    } else if (reportType === 'sales_by_payment') {
      const targetBranchIds = effectiveBranchFilter
        ? [effectiveBranchFilter]
        : branches.map((branch) => branch.id);
      const results = await Promise.all(targetBranchIds.map((branchId) => reporting.getSalesByPaymentReport({
        p_branch_id: branchId,
        p_from: fromTs,
        p_to: toExclusiveTs,
        p_payment_method: filters.payment_method || null,
        p_order_type: filters.order_type || null,
        p_warehouse_id: filters.warehouse || null,
        p_cashier_id: filters.cashier || null,
        p_status: filters.status || null,
      })));
      const methodLabels: Record<string, string> = {
        cash: t('cash'),
        card: t('card'),
        transfer: t('transfer'),
        credit: lang === 'ar' ? 'آجل — مستحق من العميل' : 'Credit — Customer outstanding',
        employee_credit: lang === 'ar' ? 'آجل موظفين' : 'Employee Credit',
        bank_legacy: lang === 'ar' ? 'بنك تاريخي غير مصنف' : 'Legacy Bank (Unclassified)',
        other: lang === 'ar' ? 'أخرى' : 'Other',
      };
      let paymentSummaryTotal = 0;
      let paymentInvoiceCount = 0;
      const methodRows = results.flatMap((result, index) => {
        const raw = requireReportData(result, signal);
        if (!Array.isArray(raw.rows)) throw new Error('REPORT_SOURCE_INVALID');
        const summaryRow = (raw.summary as Record<string, unknown> | null) || {};
        paymentSummaryTotal += Number(summaryRow.sales_total || 0);
        paymentInvoiceCount += Number(summaryRow.invoice_count || 0);
        const branchId = targetBranchIds[index];
        return raw.rows.map((item) => {
          const row = item as Record<string, unknown>;
          return {
            branchId,
            method: String(row.method || 'other'),
            total: Number(row.sales_total || 0),
            count: Number(row.invoice_count || 0),
            sourceQuality: String(row.source_quality || 'canonical'),
          };
        });
      });
      const rows = methodRows.map((row) => withBranch(row.branchId, {
        [lang === 'ar' ? 'طريقة الدفع' : 'Payment Method']: methodLabels[row.method] || row.method,
        [lang === 'ar' ? 'صافي المبيعات' : 'Net Sales']: row.total,
        [lang === 'ar' ? 'عدد الفواتير' : 'Invoices']: row.count,
        [lang === 'ar' ? 'مصدر البيانات' : 'Data Source']:
          row.sourceQuality === 'legacy_journal_fallback'
            ? (lang === 'ar' ? 'قيد تاريخي موثق' : 'Verified legacy journal')
            : row.sourceQuality === 'receivable'
              ? (lang === 'ar' ? 'ذمم مدينة' : 'Receivable')
              : (lang === 'ar' ? 'تفاصيل الدفع' : 'Payment details'),
      }));
      setData(rows);
      setChartData(methodRows.map((row) => ({
        name: `${branchNameById(row.branchId)} — ${methodLabels[row.method] || row.method}`,
        value: row.total,
      })));
      setSummary({
        total: paymentSummaryTotal,
        count: paymentInvoiceCount,
      });
    } else if (reportType === 'sales_by_employee') {
      const sales = await loadSalesByEmployeeRows({
        branchId: effectiveBranchFilter || null,
        from: allowed.from, to: allowed.to, signal,
        fromTs,
        toExclusiveTs,
        filters,
      });
      const empMap = new Map<string, { branchId: string; name: string; total: number; count: number }>();
      sales.forEach((sale: Record<string, unknown>) => {
        const cashier = sale.users as { full_name?: string; email?: string } | null;
        const name = cashier?.full_name || cashier?.email || (lang === 'ar' ? 'غير معروف' : 'Unknown');
        const branchId = String(sale.branch_id || '');
        const key = `${branchId}\u0000${String(sale.cashier_id || name)}`;
        const existing = empMap.get(key) || { branchId, name, total: 0, count: 0 };
        existing.total += netSaleAmount(sale);
        existing.count += 1;
        empMap.set(key, existing);
      });
      const rows = Array.from(empMap.values()).sort((a, b) => b.total - a.total).map((employee) => withBranch(employee.branchId, {
        [lang === 'ar' ? 'الموظف' : 'Employee']: employee.name,
        [lang === 'ar' ? 'صافي المبيعات' : 'Net Sales']: employee.total,
        [lang === 'ar' ? 'الفواتير' : 'Invoices']: employee.count,
        [lang === 'ar' ? 'متوسط الفاتورة' : 'Avg Invoice']: employee.count > 0 ? employee.total / employee.count : 0,
      }));
      setData(rows);
      setChartData(Array.from(empMap.values()).sort((a, b) => b.total - a.total).slice(0, 10).map((employee) => ({ name: employee.name, value: employee.total })));
      setSummary({ total: sales.reduce((sum: number, sale: Record<string, unknown>) => sum + netSaleAmount(sale), 0), count: sales.length });
    } else if (reportType === 'sales_by_product') {
      const products = await loadProductSalesSummary({
        branchId: effectiveBranchFilter || null, from: allowed.from, to: allowed.to, fromTs, toExclusiveTs, filters, signal,
        lang: lang as 'ar' | 'en', includeCost: false,
      });
      const label = (ar: string, en: string) => lang === 'ar' ? ar : en;
      const rows = products.map((product) => withBranch(product.branchId, {
        [label('المنتج', 'Product')]: product.name || label('غير معروف', 'Unknown'),
        [label('معرف المنتج', 'Product ID')]: product.productId || '-',
        [label('الوحدة', 'Unit')]: product.unit,
        [label('الكمية المباعة', 'Sold Quantity')]: product.soldQuantity,
        [label('الكمية المرتجعة', 'Returned Quantity')]: product.returnedQuantity,
        [label('صافي الكمية', 'Net Quantity')]: product.netQuantity,
        [label('المبيعات قبل الخصم', 'Gross Sales')]: product.gross,
        [label('الخصم الموزع', 'Allocated Discount')]: product.discount,
        [label('الضريبة الموزعة', 'Allocated Tax')]: product.tax,
        [label('قيمة المرتجع', 'Return Value')]: product.refunded,
        [label('صافي الإيراد دون الضريبة', 'Net Revenue Excluding Tax')]: product.netBeforeTax,
        [label('صافي الإيراد', 'Net Revenue')]: product.net,
      }));
      setData(rows);
      setChartData(products.slice(0, 10).map((product) => ({ name: `${product.name || label('غير معروف', 'Unknown')} (${product.unit})`, value: product.net })));
      setSummary({ total: products.reduce((sum, product) => sum + product.net, 0), count: rows.length });
    } else if (reportType === 'detailed_invoices') {
      const sales = await loadDetailedInvoiceRows({
        branchId: effectiveBranchFilter || null,
        from: allowed.from, to: allowed.to, signal,
        fromTs,
        toExclusiveTs,
        filters,
      });
      const rows = sales.map((sale: Record<string, unknown>) => {
        const customer = sale.customer as { name?: string } | null;
        const cashier = sale.cashier as { full_name?: string } | null;
        return withBranch(sale.branch_id, {
          [lang === 'ar' ? 'رقم الفاتورة' : 'Invoice']: sale.invoice_number,
          [lang === 'ar' ? 'التاريخ' : 'Date']: formatDate(sale.created_at as string, lang),
          [lang === 'ar' ? 'العميل' : 'Customer']: customer?.name || '-',
          [lang === 'ar' ? 'أمين الصندوق' : 'Cashier']: cashier?.full_name || '-',
          [lang === 'ar' ? 'طريقة الدفع' : 'Payment']: paymentMethodLabels[String(sale.payment_method)] || sale.payment_method,
          [lang === 'ar' ? 'الإجمالي الأصلي' : 'Original Total']: Number(sale.total || 0),
          [lang === 'ar' ? 'المرتجع' : 'Refunded']: Number(sale.refunded_amount || 0),
          [lang === 'ar' ? 'صافي الفاتورة' : 'Net Total']: netSaleAmount(sale),
          [lang === 'ar' ? 'صافي المدفوع' : 'Net Paid']: netSalePayment(sale),
          [lang === 'ar' ? 'الحالة' : 'Status']: statusLabels[String(sale.status)] || sale.status,
        });
      });
      setData(rows);
      setChartData([]);
      setSummary({ total: sales.reduce((sum: number, sale: Record<string, unknown>) => sum + netSaleAmount(sale), 0), count: rows.length });
    } else if (reportType === 'component_consumption') {
      const tx = await loadComponentConsumptionRows({
        branchId: effectiveBranchFilter || null,
        fromTs,
        toExclusiveTs, signal,
        filters,
      });
      const map = new Map<string, { branchId: string; name: string; qty: number; cost: number; count: number }>();
      tx.forEach((row: Record<string, unknown>) => {
        const product = row.product as { name?: string } | null;
        const name = product?.name || (lang === 'ar' ? 'غير معروف' : 'Unknown');
        const branchId = String(row.branch_id || '');
        const key = `${branchId}\u0000${String(row.product_id || name)}`;
        const current = map.get(key) || { branchId, name, qty: 0, cost: 0, count: 0 };
        const qty = -Number(row.quantity || 0);
        current.qty += qty;
        current.cost += qty * Number(row.unit_cost || 0);
        current.count += 1;
        map.set(key, current);
      });
      const rows = Array.from(map.values()).sort((a, b) => b.qty - a.qty).map((row) => withBranch(row.branchId, {
        [lang === 'ar' ? 'المكوّن' : 'Component']: row.name,
        [lang === 'ar' ? 'الكمية المستهلكة' : 'Consumed Qty']: row.qty,
        [lang === 'ar' ? 'تكلفة الاستهلاك' : 'Consumption Cost']: row.cost,
        [lang === 'ar' ? 'عدد الحركات' : 'Movements']: row.count,
      }));
      setData(rows);
      setChartData(rows.slice(0, 10).map((row) => ({ name: String(row[lang === 'ar' ? 'المكوّن' : 'Component']), value: Number(row[lang === 'ar' ? 'الكمية المستهلكة' : 'Consumed Qty']) })));
      setSummary({ total: Array.from(map.values()).reduce((sum, row) => sum + row.cost, 0), count: rows.length });
    } else if (reportType === 'top_consumed_components') {
      const tx = await loadTopConsumedComponentRows({
        branchId: effectiveBranchFilter || null,
        fromTs,
        toExclusiveTs, signal,
        filters,
      });
      const map = new Map<string, { branchId: string; name: string; qty: number }>();
      tx.forEach((row: Record<string, unknown>) => {
        const product = row.product as { name?: string } | null;
        const name = product?.name || (lang === 'ar' ? 'غير معروف' : 'Unknown');
        const branchId = String(row.branch_id || '');
        const key = `${branchId}\u0000${String(row.product_id || name)}`;
        const current = map.get(key) || { branchId, name, qty: 0 };
        current.qty += -Number(row.quantity || 0);
        map.set(key, current);
      });
      const rows = Array.from(map.values()).sort((a, b) => b.qty - a.qty).map((row) => withBranch(row.branchId, {
        [lang === 'ar' ? 'المكوّن' : 'Component']: row.name,
        [lang === 'ar' ? 'الكمية المستهلكة' : 'Consumed Qty']: row.qty,
      }));
      setData(rows);
      setChartData(rows.slice(0, 10).map((row) => ({ name: String(row[lang === 'ar' ? 'المكوّن' : 'Component']), value: Number(row[lang === 'ar' ? 'الكمية المستهلكة' : 'Consumed Qty']) })));
      setSummary({ total: rows.length, count: rows.length });
    } else if (reportType === 'top_consumed_products') {
      const items = await loadTopConsumedProductItems({
        branchId: effectiveBranchFilter || null,
        filters, from: allowed.from, to: allowed.to, fromTs, toExclusiveTs, lang, includeCost: false, signal,
      });
      // Source rows already keep branch/product identity and sale units separate.
      const rows = [...items].sort((a, b) => netSaleItemQuantity(b) - netSaleItemQuantity(a)).map(item => {
        const product = item.product as { name?: string } | null;
        const sale = item.sale as { branch_id?: string } | null;
        return withBranch(sale?.branch_id, {
          [lang === 'ar' ? 'المنتج' : 'Product']: product?.name || (lang === 'ar' ? 'غير معروف' : 'Unknown'),
          [lang === 'ar' ? 'معرف المنتج' : 'Product ID']: item.product_id || '-',
          [lang === 'ar' ? 'الوحدة' : 'Unit']: item.unit_name || '',
          [lang === 'ar' ? 'صافي الكمية' : 'Net Quantity']: netSaleItemQuantity(item),
        });
      });
      setData(rows);
      setChartData(rows.slice(0, 10).map((row) => ({ name: String(row[lang === 'ar' ? 'المنتج' : 'Product']), value: Number(row[lang === 'ar' ? 'صافي الكمية' : 'Net Quantity']) })));
      setSummary({ total: rows.length, count: rows.length });
    } else if (reportType === 'recipe_costs') {
      const result = await costing.getOverview({ p_branch_id: effectiveBranchFilter });
      if (result.error) throw result.error;
      const catName = filters.category ? options.categories.find((category) => category.id === filters.category)?.name ?? filters.category : '';
      const productIds = (result.data || []).map((row) => row.product_id);
      const productBranchRows = await loadProductBranchRows(productIds, signal);
      const productBranches = new Map(productBranchRows.map((product) => [product.id, product.branch_id]));
      const rows = (result.data || [])
        .filter((row) => row.recipe_item_count > 0)
        .filter((row) => !filters.product || row.product_id === filters.product)
        .filter((row) => !catName || row.category_name === catName)
        .map((row) => withBranch(productBranches.get(row.product_id) || effectiveBranchFilter, {
          [lang === 'ar' ? 'المنتج' : 'Product']: row.product_name,
          [lang === 'ar' ? 'تكلفة المكونات' : 'Component Cost']: Number(row.actual_cost),
          [lang === 'ar' ? 'سعر البيع' : 'Sale Price']: Number(row.sale_price),
          [lang === 'ar' ? 'الهامش' : 'Margin']: Number(row.sale_price) - Number(row.actual_cost),
        }));
      setData(rows);
      setChartData(rows.slice(0, 10).map((row) => ({ name: String(row[lang === 'ar' ? 'المنتج' : 'Product']), value: Number(row[lang === 'ar' ? 'الهامش' : 'Margin']) })));
      setSummary({ total: rows.reduce((sum, row) => sum + Number(row[lang === 'ar' ? 'تكلفة المكونات' : 'Component Cost'] || 0), 0), count: rows.length });
    } else if (reportType === 'low_stock') {
      const { rawMasters, rawBalances, unitMasters, unitBatches } = await loadLowStockSources(
        effectiveBranchFilter || null, signal,
      );
      const rawQty = new Map<string, number>();
      rawBalances.forEach((row: Record<string, unknown>) => {
        const key = `${String(row.branch_id || '')}:${String(row.raw_material_id || '')}`;
        rawQty.set(key, (rawQty.get(key) || 0) + Number(row.quantity || 0));
      });
      const unitQty = new Map<string, number>();
      unitBatches.forEach((row: Record<string, unknown>) => {
        const key = `${String(row.branch_id || '')}:${String(row.unit_id || '')}`;
        unitQty.set(key, (unitQty.get(key) || 0) + Number(row.quantity || 0));
      });
      const stockRows: Array<{ branchId: string; item: string; code: string; type: string; qty: number; threshold: number }> = [];
      rawMasters.forEach((row: Record<string, unknown>) => {
        const branchId = String(row.branch_id || '');
        const key = `${branchId}:${String(row.id || '')}`;
        stockRows.push({
          branchId,
          item: String(row.name || '-'),
          code: String(row.code || ''),
          type: lang === 'ar' ? 'خامة' : 'Raw material',
          qty: rawQty.get(key) || 0,
          threshold: Number(row.min_stock ?? 0),
        });
      });
      unitMasters.forEach((row: Record<string, unknown>) => {
        const branchId = String(row.branch_id || '');
        const key = `${branchId}:${String(row.id || '')}`;
        stockRows.push({
          branchId,
          item: String(row.name || '-'),
          code: String(row.barcode || ''),
          type: lang === 'ar' ? 'وحدة مخزون' : 'Inventory unit',
          qty: unitQty.get(key) || 0,
          threshold: Number(row.low_stock_threshold ?? row.min_stock ?? 0),
        });
      });
      const rows = stockRows
        .filter((row) => row.qty <= row.threshold)
        .sort((a, b) => a.qty - b.qty || a.item.localeCompare(b.item))
        .map((row) => withBranch(row.branchId, {
          [lang === 'ar' ? 'الصنف' : 'Item']: row.item,
          [lang === 'ar' ? 'النوع' : 'Type']: row.type,
          [lang === 'ar' ? 'الكود' : 'Code']: row.code,
          [lang === 'ar' ? 'الكمية' : 'Quantity']: row.qty,
          [lang === 'ar' ? 'الحد الأدنى' : 'Low Stock Threshold']: row.threshold,
        }));
      setData(rows);
      setChartData(rows.slice(0, 10).map((row) => ({ name: String(row[lang === 'ar' ? 'الصنف' : 'Item']), value: Number(row[lang === 'ar' ? 'الكمية' : 'Quantity']) })));
      setSummary({ total: 0, count: rows.length });
    } else if (reportType === 'cashier_performance') {
      const sales = await loadCashierPerformanceRows({
        branchId: effectiveBranchFilter || null,
        from: allowed.from, to: allowed.to, signal,
        fromTs,
        toExclusiveTs,
        filters,
      });
      const empMap = new Map<string, { branchId: string; name: string; total: number; count: number; refundCount: number }>();
      sales.forEach((sale: Record<string, unknown>) => {
        const cashier = sale.users as { full_name?: string; email?: string } | null;
        const name = cashier?.full_name || cashier?.email || (lang === 'ar' ? 'غير معروف' : 'Unknown');
        const branchId = String(sale.branch_id || '');
        const key = `${branchId}\u0000${String(sale.cashier_id || name)}`;
        const existing = empMap.get(key) || { branchId, name, total: 0, count: 0, refundCount: 0 };
        existing.total += netSaleAmount(sale);
        existing.count += 1;
        if (Number(sale.refunded_amount || 0) > 0 || ['returned', 'refunded', 'cancelled'].includes(String(sale.status || ''))) existing.refundCount += 1;
        empMap.set(key, existing);
      });
      const rows = Array.from(empMap.values()).sort((a, b) => b.total - a.total).map((employee) => withBranch(employee.branchId, {
        [lang === 'ar' ? 'الموظف' : 'Employee']: employee.name,
        [lang === 'ar' ? 'الفواتير' : 'Invoices']: employee.count,
        [lang === 'ar' ? 'صافي المبيعات' : 'Net Sales']: employee.total,
        [lang === 'ar' ? 'متوسط الفاتورة' : 'Avg Order']: employee.count > 0 ? employee.total / employee.count : 0,
        [lang === 'ar' ? 'المرتجعات' : 'Refunds']: employee.refundCount,
        [lang === 'ar' ? 'نسبة المرتجعات' : 'Refund Rate']: employee.count > 0 ? `${Math.round((employee.refundCount / employee.count) * 100)}%` : '0%',
      }));
      setData(rows);
      setChartData(Array.from(empMap.values()).sort((a, b) => b.total - a.total).slice(0, 10).map((employee) => ({ name: employee.name, value: employee.total })));
      setSummary({ total: Array.from(empMap.values()).reduce((sum, employee) => sum + employee.total, 0), count: Array.from(empMap.values()).reduce((sum, employee) => sum + employee.count, 0) });
    } else if (reportType === 'returns') {
      const returns = await loadReturnRows({
        branchId: effectiveBranchFilter || null,
        from: allowed.from, to: allowed.to, signal,
        fromTs,
        toExclusiveTs,
        filters,
      });
      const statusLabels: Record<string, string> = {
        returned: lang === 'ar' ? 'مرتجع' : 'Returned', refunded: t('refunded'), cancelled: t('statusCancelled'),
      };
      const rows = returns.map((sale: Record<string, unknown>) => {
        const customer = sale.customer as { name?: string } | null;
        const cashier = sale.cashier as { full_name?: string } | null;
        const refunded = Number(sale.refunded_amount || 0) || Number(sale.total || 0);
        return withBranch(sale.branch_id, {
          [lang === 'ar' ? 'رقم الفاتورة' : 'Invoice']: sale.invoice_number,
          [lang === 'ar' ? 'التاريخ' : 'Date']: formatDate(sale.created_at as string, lang),
          [lang === 'ar' ? 'العميل' : 'Customer']: customer?.name || '-',
          [lang === 'ar' ? 'أمين الصندوق' : 'Cashier']: cashier?.full_name || '-',
          [lang === 'ar' ? 'المبلغ المرتجع' : 'Refunded Amount']: refunded,
          [lang === 'ar' ? 'الحالة' : 'Status']: statusLabels[String(sale.status)] || sale.status,
        });
      });
      setData(rows);
      setChartData([]);
      setSummary({ total: rows.reduce((sum, row) => sum + Number(row[lang === 'ar' ? 'المبلغ المرتجع' : 'Refunded Amount'] || 0), 0), count: rows.length });
    } else if (reportType === 'financial_reconciliation') {
      const targetBranchIds = effectiveBranchFilter
        ? [effectiveBranchFilter]
        : branches.map((branch) => branch.id);
      const results = await Promise.all(targetBranchIds.map((branchId) => reporting.getFinancialReconciliationReport({
        p_branch_id: branchId,
        p_from: fromTs,
        p_to: toExclusiveTs,
      })));
      const reconciliationRows: Record<string, unknown>[] = [];
      let totalNetSales = 0;
      let mismatchCount = 0;
      results.forEach((result, index) => {
        const raw = requireReportData(result, signal);
        const branchId = targetBranchIds[index];
        const summaryRow = (raw.summary as Record<string, unknown> | null) || {};
        totalNetSales += Number(summaryRow.net_sales || 0);
        mismatchCount += Number(summaryRow.mismatch_count || 0);
        if (!Array.isArray(raw.rows)) throw new Error('REPORT_SOURCE_INVALID');
        raw.rows.forEach((item) => {
          const row = item as Record<string, unknown>;
          const status = String(row.reconciliation_status || 'matched');
          reconciliationRows.push(withBranch(branchId, {
            [lang === 'ar' ? 'التاريخ' : 'Date']: formatDate(String(row.created_at || ''), lang),
            [lang === 'ar' ? 'رقم الفاتورة' : 'Invoice']: String(row.invoice_number || ''),
            [lang === 'ar' ? 'صافي الفاتورة' : 'Net Sale']: Number(row.net_sale || 0),
            [lang === 'ar' ? 'كاش' : 'Cash']: Number(row.cash || 0),
            [lang === 'ar' ? 'كارت' : 'Card']: Number(row.card || 0),
            [lang === 'ar' ? 'تحويل' : 'Transfer']: Number(row.transfer || 0),
            [lang === 'ar' ? 'بنك تاريخي غير مصنف' : 'Legacy Bank']: Number(row.legacy_bank || 0),
            [lang === 'ar' ? 'آجل — مستحق من العميل' : 'Credit — Customer outstanding']: Number(row.credit || 0),
            [lang === 'ar' ? 'حركة الخزنة' : 'Cash GL']: Number(row.cash_gl || 0),
            [lang === 'ar' ? 'حركة البنك' : 'Bank GL']: Number(row.bank_gl || 0),
            [lang === 'ar' ? 'فرق الخزنة' : 'Cash Difference']: Number(row.cash_diff || 0),
            [lang === 'ar' ? 'فرق البنك' : 'Bank Difference']: Number(row.bank_diff || 0),
            [lang === 'ar' ? 'المطابقة' : 'Reconciliation']:
              status === 'mismatch'
                ? (lang === 'ar' ? 'يوجد فرق' : 'Mismatch')
                : status === 'matched_legacy'
                  ? (lang === 'ar' ? 'مطابق — مصدر تاريخي' : 'Matched — legacy source')
                  : (lang === 'ar' ? 'مطابق' : 'Matched'),
          }));
        });
      });
      setData(reconciliationRows);
      setChartData([]);
      setSummary({ total: totalNetSales, count: mismatchCount });
    } else if (reportType === 'daily_closing_range') {
      const targetBranches = effectiveBranchFilter
        ? branches.filter((branch) => branch.id === effectiveBranchFilter)
        : branches;
      const results = await readReportBranches(targetBranches, async (branch) => {
        const result = await reporting.getDayClosingRangeReport({
          p_branch_id: branch.id,
          p_from_date: allowed.from,
          p_to_date: allowed.to,
        });
        if (result.error) throw result.error;
        const payload = (result.data || {}) as Record<string, unknown>;
        return {
          branchId: branch.id,
          rows: Array.isArray(payload.rows) ? payload.rows as Record<string, unknown>[] : [],
        };
      }, signal);
      const rows = results.flatMap(({ branchId, rows: dayRows }) => dayRows.map((row) => withBranch(branchId, {
        [lang === 'ar' ? 'اليوم' : 'Business Date']: String(row.business_date || ''),
        [lang === 'ar' ? 'إجمالي المبيعات' : 'Gross Sales']: Number(row.gross_sales || 0),
        [lang === 'ar' ? 'الخصومات' : 'Discounts']: Number(row.discounts || 0),
        [lang === 'ar' ? 'الضرائب' : 'Taxes']: Number(row.taxes || 0),
        [lang === 'ar' ? 'المرتجعات' : 'Returns']: Number(row.returns || 0),
        [lang === 'ar' ? 'صافي المبيعات' : 'Net Sales']: Number(row.net_sales || 0),
        [lang === 'ar' ? 'كاش' : 'Cash']: Number(row.cash || 0),
        [lang === 'ar' ? 'كارت' : 'Card']: Number(row.card || 0),
        [lang === 'ar' ? 'تحويل' : 'Transfer']: Number(row.transfer || 0),
        [lang === 'ar' ? 'آجل' : 'Credit']: Number(row.credit || 0),
        [lang === 'ar' ? 'بنك تاريخي غير مصنف' : 'Legacy Bank']: Number(row.legacy_bank || 0),
        [lang === 'ar' ? 'طرق دفع أخرى' : 'Other Payment']: Number(row.other_payment || 0),
        [lang === 'ar' ? 'المصروفات' : 'Expenses']: Number(row.expenses || 0),
        [lang === 'ar' ? 'مشتريات كاش' : 'Cash Purchases']: Number(row.cash_purchases || 0),
        [lang === 'ar' ? 'صافي كاش بعد المنصرف' : 'Cash After Outflows']: Number(row.cash_after_outflows || 0),
        [lang === 'ar' ? 'عدد الفواتير' : 'Invoices']: Number(row.invoice_count || 0),
        [lang === 'ar' ? 'عدد الشفتات' : 'Shifts']: Number(row.shift_count || 0),
        [lang === 'ar' ? 'حالة اليوم' : 'Day Status']:
          row.daily_close_status === 'closed'
            ? (lang === 'ar' ? 'مغلق' : 'Closed')
            : (lang === 'ar' ? 'مفتوح' : 'Open'),
      })));
      setData(rows);
      setChartData([]);
      setSummary({
        total: rows.reduce((sum, row) => sum + Number(row[lang === 'ar' ? 'صافي المبيعات' : 'Net Sales'] || 0), 0),
        count: rows.length,
      });
    } else if (reportType === 'raw_material_consumption' || reportType === 'inventory_as_of') {
      if (reportType === 'inventory_as_of' && (!can('reports.view') || !can('reports.costing'))) throw new Error('PERMISSION_DENIED:reports.costing');
      const targetBranches = effectiveBranchFilter
        ? branches.filter((branch) => branch.id === effectiveBranchFilter)
        : branches;
      const results = await readReportBranches(targetBranches, async (branch) => {
        const result = await reporting.getRawMaterialConsumptionReport({
          p_branch_id: branch.id,
          p_from_date: allowed.from,
          p_to_date: allowed.to,
        }, signal);
        const raw = requireReportData(result, signal);
        if (!Array.isArray(raw)) throw new Error('REPORT_SOURCE_INVALID');
        return { branchId: branch.id, rows: raw as Record<string, unknown>[] };
      }, signal);
      const rows = results.flatMap(({ branchId, rows: rawRows }) => rawRows.map((row) => withBranch(branchId, {
        [lang === 'ar' ? 'الخامة' : 'Raw Material']: row.raw_material_name || '-',
        [lang === 'ar' ? 'الكود' : 'Code']: row.raw_material_code || '',
        [lang === 'ar' ? 'الوحدة' : 'Unit']: row.unit_name || '',
        [lang === 'ar' ? 'رصيد أول المدة' : 'Opening Qty']: Number(row.opening_quantity || 0),
        [lang === 'ar' ? 'المشتريات كمية' : 'Purchase Qty']: Number(row.purchase_quantity || 0),
        [lang === 'ar' ? 'تحويلات داخلة' : 'Transfer In']: Number(row.transfer_in_quantity || 0),
        [lang === 'ar' ? 'تحويلات خارجة' : 'Transfer Out']: Number(row.transfer_out_quantity || 0),
        [lang === 'ar' ? 'استهلاك المبيعات' : 'Sales Consumption Qty']: Number(row.sales_consumption_quantity || 0),
        [lang === 'ar' ? 'قيمة الاستهلاك' : 'Consumption Value']: Number(row.sales_consumption_value || 0),
        [lang === 'ar' ? 'الهالك' : 'Waste Qty']: Number(row.waste_quantity || 0),
        [lang === 'ar' ? 'تسويات وحركات أخرى' : 'Other Net Qty']: Number(row.other_net_quantity || 0),
        [lang === 'ar' ? 'رصيد آخر المدة' : 'Closing Qty']: Number(row.closing_quantity || 0),
        [lang === 'ar' ? 'قيمة آخر المدة' : 'Closing Value']: Number(row.closing_value || 0),
      })));
      const output = reportType === 'inventory_as_of' ? results.flatMap(({ branchId, rows: rawRows }) => rawRows.map(row => withBranch(branchId, {
        [lang === 'ar' ? 'التاريخ' : 'Date']: allowed.to,
        [lang === 'ar' ? 'الخامة' : 'Raw Material']: row.raw_material_name || '-',
        [lang === 'ar' ? 'الكود' : 'Code']: row.raw_material_code || '',
        [lang === 'ar' ? 'الوحدة' : 'Unit']: row.unit_name || '',
        [lang === 'ar' ? 'الرصيد بنهاية اليوم' : 'End-of-day Qty']: Number(row.closing_quantity || 0),
        [lang === 'ar' ? 'القيمة المسجلة بنهاية اليوم' : 'End-of-day Recorded Value']: Number(row.closing_value || 0),
      }))) : rows;
      if (output.length > MAX_REPORT_SOURCE_ROWS) throw new Error('REPORT_SOURCE_LIMIT');
      setData(output);
      setChartData([]);
      setSummary({
        total: reportType === 'inventory_as_of' ? output.reduce((sum, row) => sum + Number(row[lang === 'ar' ? 'القيمة المسجلة بنهاية اليوم' : 'End-of-day Recorded Value'] || 0), 0) : rows.reduce((sum, row) => sum + Number(row[lang === 'ar' ? 'قيمة الاستهلاك' : 'Consumption Value'] || 0), 0),
        count: output.length,
      });
    } else if (reportType === 'raw_material_current_cost') {
      const targetBranches = effectiveBranchFilter
        ? branches.filter((branch) => branch.id === effectiveBranchFilter)
        : branches;
      const results = await readReportBranches(targetBranches, async (branch) => {
        const result = await reporting.getCurrentRawMaterialValuation({ p_branch_id: branch.id }, signal);
        if (result.error) throw result.error;
        return { branchId: branch.id, rows: Array.isArray(result.data) ? result.data as Record<string, unknown>[] : [] };
      }, signal);
      const rows = results.flatMap(({ branchId, rows: rawRows }) => rawRows.map((row) => withBranch(branchId, {
        [lang === 'ar' ? 'الخامة' : 'Raw Material']: row.raw_material_name || '-',
        [lang === 'ar' ? 'الكود' : 'Code']: row.raw_material_code || '',
        [lang === 'ar' ? 'الوحدة' : 'Unit']: row.unit_name || '',
        [lang === 'ar' ? 'الكمية الحالية' : 'Current Qty']: Number(row.current_quantity || 0),
        [lang === 'ar' ? 'سعر الخامة المعتمد (مركز التكلفة)' : 'Canonical Raw Cost (Costing Center)']: Number(row.latest_authoritative_cost || 0),
        [lang === 'ar' ? 'متوسط تكلفة المخزون المتبقي FIFO' : 'Remaining Inventory FIFO Average Cost']: Number(row.fifo_current_unit_cost || 0),
        [lang === 'ar' ? 'قيمة المخزون الحالية' : 'Current Inventory Value']: Number(row.current_inventory_value || 0),
        [lang === 'ar' ? 'مصدر السعر' : 'Price Source']: row.price_source || '',
        [lang === 'ar' ? 'طبقات FIFO المفتوحة' : 'Open FIFO Batches']: Number(row.open_fifo_batches || 0),
        [lang === 'ar' ? 'دين FIFO غير مسوّى' : 'Outstanding FIFO Debt']: Number(row.outstanding_fifo_debt_quantity || 0),
        [lang === 'ar' ? 'عدد ديون FIFO' : 'FIFO Debt Rows']: Number(row.outstanding_fifo_debt_rows || 0),
        [lang === 'ar' ? 'قيمة الدين التقديرية' : 'Estimated Debt Value']: Number(row.estimated_fifo_debt_value || 0),
        [lang === 'ar' ? 'دين بلا سعر' : 'Unpriced Debt Qty']: Number(row.unpriced_fifo_debt_quantity || 0),
        [lang === 'ar' ? 'تغطية تسعير الدين %' : 'Debt Pricing Coverage %']: Number(row.fifo_debt_pricing_coverage_pct || 0),
        [lang === 'ar' ? 'أقدم دين' : 'Oldest Debt']: row.oldest_outstanding_debt_at
          ? formatDate(String(row.oldest_outstanding_debt_at), lang)
          : '',
        [lang === 'ar' ? 'آخر توريد شراء' : 'Last Purchase Receipt']: row.last_purchase_receipt_at
          ? formatDate(String(row.last_purchase_receipt_at), lang)
          : '',
        [lang === 'ar' ? 'حالة الدين' : 'Debt Status']: rawDebtStatusLabel(row.fifo_debt_status),
      })));
      setData(rows);
      setChartData([]);
      setSummary({
        total: rows.reduce((sum, row) => sum + Number(row[lang === 'ar' ? 'قيمة المخزون الحالية' : 'Current Inventory Value'] || 0), 0),
        count: rows.length,
      });
    } else if (reportType === 'raw_material_financial') {
      const targetBranches = effectiveBranchFilter
        ? branches.filter((branch) => branch.id === effectiveBranchFilter)
        : branches;
      const results = await readReportBranches(targetBranches, async (branch) => {
        const result = await reporting.getRawMaterialFinancialReport({
          p_branch_id: branch.id,
          p_from_date: allowed.from,
          p_to_date: allowed.to,
        });
        if (result.error) throw result.error;
        const payload = (result.data || {}) as Record<string, unknown>;
        return {
          branchId: branch.id,
          summary: (payload.summary || {}) as Record<string, unknown>,
          rows: Array.isArray(payload.rows) ? payload.rows as Record<string, unknown>[] : [],
        };
      }, signal);
      const rows = results.flatMap(({ branchId, summary: financial, rows: rawRows }) => {
        const summaryRow = withBranch(branchId, {
          [lang === 'ar' ? 'الخامة' : 'Raw Material']: lang === 'ar' ? 'إجمالي الفترة' : 'Period Total',
          [lang === 'ar' ? 'قيمة أول المدة' : 'Opening Value']: Number(financial.opening_inventory_value || 0),
          [lang === 'ar' ? 'قيمة المشتريات' : 'Purchase Value']: Number(financial.purchases_value || 0),
          [lang === 'ar' ? 'صافي المبيعات' : 'Net Sales']: Number(financial.net_sales || 0),
          [lang === 'ar' ? 'قيمة استهلاك المبيعات' : 'Sales Consumption Value']: Number(financial.sales_consumption_value || 0),
          [lang === 'ar' ? 'قيمة آخر المدة' : 'Closing Value']: Number(financial.closing_inventory_value || 0),
          [lang === 'ar' ? 'مجمل الربح' : 'Gross Profit']: Number(financial.gross_profit || 0),
          [lang === 'ar' ? 'نسبة تكلفة الخامات %' : 'Food Cost %']: Number(financial.food_cost_pct || 0),
        });
        const detailRows = rawRows.map((row) => withBranch(branchId, {
          [lang === 'ar' ? 'الخامة' : 'Raw Material']: row.raw_material_name || '-',
          [lang === 'ar' ? 'الوحدة' : 'Unit']: row.unit_name || '',
          [lang === 'ar' ? 'كمية أول المدة' : 'Opening Qty']: Number(row.opening_quantity || 0),
          [lang === 'ar' ? 'قيمة أول المدة' : 'Opening Value']: Number(row.opening_value || 0),
          [lang === 'ar' ? 'كمية المشتريات' : 'Purchase Qty']: Number(row.purchase_quantity || 0),
          [lang === 'ar' ? 'قيمة المشتريات' : 'Purchase Value']: Number(row.purchase_value || 0),
          [lang === 'ar' ? 'كمية استهلاك المبيعات' : 'Sales Consumption Qty']: Number(row.sales_consumption_quantity || 0),
          [lang === 'ar' ? 'قيمة استهلاك المبيعات' : 'Sales Consumption Value']: Number(row.sales_consumption_value || 0),
          [lang === 'ar' ? 'كمية آخر المدة' : 'Closing Qty']: Number(row.closing_quantity || 0),
          [lang === 'ar' ? 'قيمة آخر المدة' : 'Closing Value']: Number(row.closing_value || 0),
        }));
        return [summaryRow, ...detailRows];
      });
      setData(rows);
      setChartData([]);
      setSummary({
        total: results.reduce((sum, result) => sum + Number(result.summary.net_sales || 0), 0),
        count: results.reduce((sum, result) => sum + result.rows.length, 0),
      });
    } else if (reportType === 'sales_component_reconciliation') {
      const targetBranches = effectiveBranchFilter
        ? branches.filter((branch) => branch.id === effectiveBranchFilter)
        : branches;
      const results = await readReportBranches(targetBranches, async (branch) => {
        const result = await reporting.getSalesComponentReconciliationReport({
          p_branch_id: branch.id,
          p_from_date: allowed.from,
          p_to_date: allowed.to,
        });
        if (result.error) throw result.error;
        const payload = (result.data || {}) as Record<string, unknown>;
        return {
          branchId: branch.id,
          summary: (payload.summary || {}) as Record<string, unknown>,
          rows: Array.isArray(payload.rows) ? payload.rows as Record<string, unknown>[] : [],
        };
      }, signal);
      const rows = results.flatMap(({ branchId, summary: reconciliation, rows: rawRows }) => {
        const summaryRow = withBranch(branchId, {
          [lang === 'ar' ? 'الخامة' : 'Raw Material']: lang === 'ar' ? 'إجمالي الفترة' : 'Period Total',
          [lang === 'ar' ? 'عدد المنتجات' : 'Products']: '',
          [lang === 'ar' ? 'الاستهلاك النظري كمية' : 'Theoretical Qty']: Number(reconciliation.theoretical_quantity || 0),
          [lang === 'ar' ? 'الاستهلاك الفعلي كمية' : 'Actual Qty']: Number(reconciliation.actual_quantity || 0),
          [lang === 'ar' ? 'فرق الكمية' : 'Qty Difference']: Number(reconciliation.theoretical_quantity || 0) - Number(reconciliation.actual_quantity || 0),
          [lang === 'ar' ? 'تكلفة الوحدة للمقارنة' : 'Comparison Unit Cost']: '',
          [lang === 'ar' ? 'قيمة الاستهلاك النظري' : 'Theoretical Value']: Number(reconciliation.theoretical_value || 0),
          [lang === 'ar' ? 'قيمة الاستهلاك الفعلي' : 'Actual Value']: Number(reconciliation.actual_value || 0),
          [lang === 'ar' ? 'فرق القيمة' : 'Value Difference']: Number(reconciliation.value_difference || 0),
          [lang === 'ar' ? 'نسبة الفرق %' : 'Variance %']: Number(reconciliation.theoretical_value || 0) !== 0
            ? Number(reconciliation.value_difference || 0) / Number(reconciliation.theoretical_value || 0) * 100
            : 0,
          [lang === 'ar' ? 'مصدر التسعير' : 'Price Source']: lang === 'ar'
            ? `نظري ${formatPercent(Number(reconciliation.theoretical_food_cost_pct || 0), 2)} / فعلي ${formatPercent(Number(reconciliation.actual_food_cost_pct || 0), 2)}`
            : `Theo ${formatPercent(Number(reconciliation.theoretical_food_cost_pct || 0), 2)} / Actual ${formatPercent(Number(reconciliation.actual_food_cost_pct || 0), 2)}`,
          [lang === 'ar' ? 'الحالة' : 'Status']: lang === 'ar'
            ? `فروق خامات: ${Number(reconciliation.mismatched_raws || 0)} · بنود غير قابلة للمطابقة: ${Number(reconciliation.unmatched_sale_rows || 0)} · منتجات بلا مكونات: ${Number(reconciliation.componentless_products || 0)}`
            : `Raw mismatches: ${Number(reconciliation.mismatched_raws || 0)} · Unmatched sale rows: ${Number(reconciliation.unmatched_sale_rows || 0)} · Products without components: ${Number(reconciliation.componentless_products || 0)}`,
        });
        const detailRows = rawRows.map((row) => withBranch(branchId, {
          [lang === 'ar' ? 'الخامة' : 'Raw Material']: row.raw_material_name || '-',
          [lang === 'ar' ? 'عدد المنتجات' : 'Products']: Number(row.product_count || 0),
          [lang === 'ar' ? 'الاستهلاك النظري كمية' : 'Theoretical Qty']: Number(row.theoretical_quantity || 0),
          [lang === 'ar' ? 'الاستهلاك الفعلي كمية' : 'Actual Qty']: Number(row.actual_quantity || 0),
          [lang === 'ar' ? 'فرق الكمية' : 'Qty Difference']: Number(row.quantity_difference || 0),
          [lang === 'ar' ? 'تكلفة الوحدة للمقارنة' : 'Comparison Unit Cost']: Number(row.compare_unit_cost || 0),
          [lang === 'ar' ? 'قيمة الاستهلاك النظري' : 'Theoretical Value']: Number(row.theoretical_value || 0),
          [lang === 'ar' ? 'قيمة الاستهلاك الفعلي' : 'Actual Value']: Number(row.actual_value || 0),
          [lang === 'ar' ? 'فرق القيمة' : 'Value Difference']: Number(row.value_difference || 0),
          [lang === 'ar' ? 'نسبة الفرق %' : 'Variance %']: Number(row.variance_pct || 0),
          [lang === 'ar' ? 'مصدر التسعير' : 'Price Source']: row.price_source || '',
          [lang === 'ar' ? 'الحالة' : 'Status']: row.status || '',
        }));
        return [summaryRow, ...detailRows];
      });
      setData(rows);
      setChartData([]);
      setSummary({
        total: results.reduce((sum, result) => sum + Number(result.summary.theoretical_value || 0), 0),
        count: results.reduce((sum, result) => sum + Number(result.summary.mismatched_raws || 0), 0),
      });
    } else if (reportType === 'production_waste') {
      const waste = await loadWasteRows({
        branchId: effectiveBranchFilter || null,
        fromTs,
        toExclusiveTs, signal,
        filters,
      });
      const rows = waste.map((row: Record<string, unknown>) => {
        const product = row.product as { name?: string } | null;
        const warehouse = row.warehouse as { name?: string } | null;
        return withBranch(row.branch_id, {
          [lang === 'ar' ? 'المنتج' : 'Product']: product?.name || '-',
          [lang === 'ar' ? 'التاريخ' : 'Date']: formatDate(row.created_at as string, lang),
          [lang === 'ar' ? 'الكمية' : 'Quantity']: Number(row.quantity || 0),
          [lang === 'ar' ? 'تكلفة الوحدة' : 'Unit Cost']: Number(row.unit_cost || 0),
          [lang === 'ar' ? 'التكلفة الإجمالية' : 'Total Cost']: Number(row.total_cost || 0),
          [lang === 'ar' ? 'السبب' : 'Reason']: row.reason || '-',
          [lang === 'ar' ? 'المستودع' : 'Warehouse']: warehouse?.name || '-',
        });
      });
      setData(rows);
      setChartData(rows.slice(0, 10).map((row) => ({ name: String(row[lang === 'ar' ? 'المنتج' : 'Product']), value: Number(row[lang === 'ar' ? 'التكلفة الإجمالية' : 'Total Cost']) })));
      setSummary({ total: rows.reduce((sum, row) => sum + Number(row[lang === 'ar' ? 'التكلفة الإجمالية' : 'Total Cost'] || 0), 0), count: rows.length });
    }
    return { rows: resultRows, summary: corePage?.summary ?? resultSummary, serverPaged: !!corePage, from: allowed.from, to: allowed.to };
  }

  const handleExportExcel = async (complete: ReportSnapshot) => {
    const excelProfile = getReportExcelProfile(reportType, lang as 'ar' | 'en');
    const totalRow = reportType === 'sales_by_station'
      ? stationTotals(complete.rows)
      : reportType === 'financial_reconciliation'
      ? {
        [lang === 'ar' ? 'صافي المبيعات' : 'Net Sales']: complete.summary.total,
        [lang === 'ar' ? 'عدد الفروق' : 'Mismatch Count']: complete.summary.count,
      }
      : {
        [lang === 'ar' ? 'الإجمالي' : 'Total']: complete.summary.total,
        [lang === 'ar' ? 'عدد السجلات' : 'Record Count']: complete.summary.count,
      };
    await exportToExcelAdvanced({
      data: complete.rows,
      filename: `report_${reportType}_${complete.from ?? from}_${complete.to ?? to}`,
      sheetName: (reportTypes.find((row) => row.key === reportType)?.label ?? reportType).slice(0, 31),
      title: reportTypes.find((row) => row.key === reportType)?.label ?? reportType,
      subtitle: `${reportBranchLabel} — ${complete.from ?? from} — ${complete.to ?? to}`,
      totalRow,
      currencyColumns: moneyKeys,
      integerColumns: excelProfile.integerColumns,
      columns,
      columnWidths: excelProfile.columnWidths,
      sourceNote: excelProfile.sourceNote,
      lang,
    });
  };
  const handleExportCSV = (complete: ReportSnapshot) => { downloadCSV(complete.rows.map(row => Object.fromEntries(columns.map(key => [key, row[key]]))), `report_${reportType}_${complete.from ?? from}_${complete.to ?? to}`); };

  const reportTypes: { key: ReportType; label: string; icon: React.ReactNode }[] = [
    { key: 'sales_costs', label: lang === 'ar' ? 'تكلفة المباع وربحه' : 'Sold-item Costs & Profit', icon: <BarChart3 className="w-4 h-4" /> },
    { key: 'inventory_as_of', label: lang === 'ar' ? 'أرصدة الخامات بتاريخ' : 'Material Balances as of Date', icon: <Package className="w-4 h-4" /> },
    { key: 'sales', label: t('salesReport'), icon: <TrendingUp className="w-4 h-4" /> },
    { key: 'sales_by_payment', label: t('salesByPayment'), icon: <CreditCard className="w-4 h-4" /> },
    { key: 'sales_by_employee', label: t('salesByEmployee'), icon: <Users className="w-4 h-4" /> },
    { key: 'sales_by_station', label: lang === 'ar' ? 'المبيعات حسب المحطة والتصنيف' : 'Sales by Station & Category', icon: <Package className="w-4 h-4" /> },
    { key: 'sales_by_product', label: t('salesByProduct'), icon: <Package className="w-4 h-4" /> },
    { key: 'detailed_invoices', label: t('detailedInvoices'), icon: <List className="w-4 h-4" /> },
    { key: 'purchases', label: t('purchasesReport'), icon: <ShoppingCart className="w-4 h-4" /> },
    { key: 'expenses', label: t('expensesReport'), icon: <Receipt className="w-4 h-4" /> },
    { key: 'profit', label: t('profitReport'), icon: <BarChart3 className="w-4 h-4" /> },
    { key: 'inventory', label: t('inventoryReport'), icon: <Package className="w-4 h-4" /> },
    { key: 'low_stock', label: t('lowStockReport'), icon: <AlertTriangle className="w-4 h-4" /> },
    { key: 'cashier_performance', label: t('cashierPerformanceReport'), icon: <UserCheck className="w-4 h-4" /> },
    { key: 'returns', label: t('returnsReport'), icon: <RotateCcw className="w-4 h-4" /> },
    { key: 'production_waste', label: t('productionWasteReport'), icon: <Trash2 className="w-4 h-4" /> },
  ];
  if (can('reports.costing') || canFinancial) {
    reportTypes.push(
      { key: 'raw_material_consumption', label: lang === 'ar' ? 'حركة واستهلاك الخامات' : 'Raw Material Consumption', icon: <Layers className="w-4 h-4" /> },
      { key: 'raw_material_current_cost', label: lang === 'ar' ? 'تكلفة الخامات الحالية' : 'Current Raw Material Cost', icon: <Package className="w-4 h-4" /> },
      { key: 'sales_component_reconciliation', label: lang === 'ar' ? 'مطابقة المبيعات مع استهلاك المكونات' : 'Sales vs Component Consumption', icon: <BarChart3 className="w-4 h-4" /> },
    );
  }
  if (canFinancial) {
    reportTypes.push({
      key: 'raw_material_financial',
      label: lang === 'ar' ? 'التقرير المالي للخامات والمبيعات' : 'Raw Material Financial Report',
      icon: <BarChart3 className="w-4 h-4" />,
    });
    reportTypes.push({
      key: 'daily_closing_range',
      label: lang === 'ar' ? 'حركة الأيام وطرق الدفع' : 'Daily Closing & Payments',
      icon: <CreditCard className="w-4 h-4" />,
    });
    reportTypes.push({
      key: 'financial_reconciliation',
      label: lang === 'ar' ? 'المطابقة المالية' : 'Financial Reconciliation',
      icon: <CreditCard className="w-4 h-4" />,
    });
  }

  const moneyKeys = [
    'تكلفة المباع بالأسعار الحالية', 'Current-price Sold Cost', 'تكلفة المكونات المسعرة فقط', 'Priced Components Only', 'مجمل الربح المسجل', 'Recorded Gross Profit', 'مجمل الربح بالأسعار الحالية', 'Current-price Gross Profit', 'القيمة المسجلة بنهاية اليوم', 'End-of-day Recorded Value',
    'سعر الوحدة', 'Unit Price', 'المبيعات قبل الخصم', 'Gross Sales', 'الخصم الموزع', 'Allocated Discount', 'الضريبة الموزعة', 'Allocated Tax', 'قيمة المرتجع', 'Return Value', 'صافي الإيراد دون الضريبة', 'Net Revenue Excluding Tax', 'التكلفة المسجلة', 'Recorded Cost', 'تكلفة بآخر سعر (تقديرية)', 'Latest Price Cost (Estimated)', 'تكلفة المكونات المسعرة (تقديرية)', 'Priced Components Cost (Estimated)',
    lang === 'ar' ? 'الإجمالي' : 'Total', lang === 'ar' ? 'المبلغ' : 'Amount',
    lang === 'ar' ? 'الإجمالي الأصلي' : 'Original Total', lang === 'ar' ? 'المرتجع' : 'Refunded',
    lang === 'ar' ? 'صافي المبيعات' : 'Net Sales', lang === 'ar' ? 'مرتجع المشتريات' : 'Returned',
    lang === 'ar' ? 'صافي المشتريات' : 'Net Purchases', lang === 'ar' ? 'صافي المدفوع' : 'Net Paid',
    lang === 'ar' ? 'صافي الإيراد' : 'Net Revenue', lang === 'ar' ? 'تكلفة البضاعة المباعة' : 'COGS',
    lang === 'ar' ? 'مجمل الربح' : 'Gross Profit', lang === 'ar' ? 'المصروفات' : 'Expenses',
    lang === 'ar' ? 'صافي الربح' : 'Net Profit', lang === 'ar' ? 'صافي الفاتورة' : 'Net Total',
    lang === 'ar' ? 'متوسط الفاتورة' : 'Avg Invoice', lang === 'ar' ? 'متوسط الفاتورة' : 'Avg Order',
    lang === 'ar' ? 'تكلفة الاستهلاك' : 'Consumption Cost', lang === 'ar' ? 'تكلفة المكونات' : 'Component Cost',
    lang === 'ar' ? 'سعر البيع' : 'Sale Price', lang === 'ar' ? 'الهامش' : 'Margin',
    lang === 'ar' ? 'تكلفة الوحدة' : 'Unit Cost', lang === 'ar' ? 'التكلفة الإجمالية' : 'Total Cost',
    lang === 'ar' ? 'المبلغ المرتجع' : 'Refunded Amount',
    lang === 'ar' ? 'كاش' : 'Cash', lang === 'ar' ? 'كارت' : 'Card',
    lang === 'ar' ? 'تحويل' : 'Transfer', lang === 'ar' ? 'بنك تاريخي غير مصنف' : 'Legacy Bank',
    lang === 'ar' ? 'آجل' : 'Credit', lang === 'ar' ? 'حركة الخزنة' : 'Cash GL',
    lang === 'ar' ? 'حركة البنك' : 'Bank GL', lang === 'ar' ? 'فرق الخزنة' : 'Cash Difference',
    lang === 'ar' ? 'فرق البنك' : 'Bank Difference',
    lang === 'ar' ? 'قيمة الاستهلاك' : 'Consumption Value',
    lang === 'ar' ? 'قيمة أول المدة' : 'Opening Value',
    lang === 'ar' ? 'قيمة المشتريات' : 'Purchase Value',
    lang === 'ar' ? 'قيمة استهلاك المبيعات' : 'Sales Consumption Value',
    lang === 'ar' ? 'قيمة آخر المدة' : 'Closing Value',
    lang === 'ar' ? 'قيمة المخزون الحالية' : 'Current Inventory Value',
    lang === 'ar' ? 'تكلفة الوحدة الحالية FIFO' : 'Current FIFO Unit Cost',
    lang === 'ar' ? 'آخر تكلفة معتمدة' : 'Latest Authoritative Cost',
    lang === 'ar' ? 'إجمالي المبيعات' : 'Gross Sales',
    lang === 'ar' ? 'الخصومات' : 'Discounts',
    lang === 'ar' ? 'الضرائب' : 'Taxes',
    lang === 'ar' ? 'المرتجعات' : 'Returns',
    lang === 'ar' ? 'طرق دفع أخرى' : 'Other Payment',
    lang === 'ar' ? 'مشتريات كاش' : 'Cash Purchases',
    lang === 'ar' ? 'صافي كاش بعد المنصرف' : 'Cash After Outflows',
    lang === 'ar' ? 'تكلفة الوحدة للمقارنة' : 'Comparison Unit Cost',
    lang === 'ar' ? 'قيمة الاستهلاك النظري' : 'Theoretical Value',
    lang === 'ar' ? 'قيمة الاستهلاك الفعلي' : 'Actual Value',
    lang === 'ar' ? 'فرق القيمة' : 'Value Difference',
  ];

  const showDate = DATE_DRIVEN_REPORTS.has(reportType);
  const allColumns = orderReportColumns(data.length > 0 ? Object.keys(data[0]) : [], columnOrder);
  const columns = visibleColumns ? allColumns.filter((column) => visibleColumns.includes(column)) : allColumns;
  const hiddenCount = visibleColumns ? allColumns.length - columns.length : 0;
  const reportMobilePrimaryColumns = columns.slice(0, 4);
  const reportMobileSecondaryColumns = columns.slice(4);
  const allDefault = lang === 'ar' ? 'الكل' : 'All';
  const orderTypeLabels: Record<string, string> = { dine_in: t('dineIn'), takeaway: t('takeaway'), delivery: t('delivery'), drive_thru: t('driveThru') };
  const paymentMethodLabels: Record<string, string> = { cash: t('cash'), card: t('card'), transfer: t('transfer'), credit: t('credit'), split: lang === 'ar' ? 'دفع مقسم' : 'Split payment' };
  const statusLabels: Record<string, string> = {
    completed: t('statusCompleted'), returned: lang === 'ar' ? 'مرتجع' : 'Returned', refunded: t('refunded'),
    cancelled: t('statusCancelled'), pending: t('statusPending'),
  };

  const filterLabel = (dim: ReportFilterKey): string => {
    const labels: Record<ReportFilterKey, string> = {
      warehouse: t('filterByWarehouse'), cashier: t('filterByCashier'), customer: t('filterByCustomer'),
      station: lang === 'ar' ? 'المحطة' : 'Station',
      supplier: t('filterBySupplier'), buyer: t('filterByBuyer'), product: t('filterByProduct'),
      category: t('filterByCategory'), order_type: t('filterByOrderType'), payment_method: t('filterByPaymentMethod'),
      table: t('filterByTable'), status: t('filterByStatus'),
    };
    return labels[dim];
  };

  const allLabel = (dim: ReportFilterKey): string => {
    const labels: Partial<Record<ReportFilterKey, string>> = {
      station: lang === 'ar' ? 'كل المحطات' : 'All stations',
      warehouse: t('allWarehouses'), customer: t('allCustomers'), supplier: t('allSuppliers'), product: t('allProducts'),
      category: t('allCategories'), order_type: t('allOrderTypes'), payment_method: t('allPaymentMethods'),
      status: t('allStatuses'), table: t('allTables'),
    };
    return labels[dim] || allDefault;
  };

  const filterOptions = (dim: ReportFilterKey): { value: string; label: string }[] => {
    const name = (value: string, english: string | null) => (lang === 'ar' ? value : (english || value));
    switch (dim) {
      case 'station': return [...options.stations.map(station => ({ value: station.id, label: lang === 'ar' ? station.name_ar : station.name_en || station.name_ar })), { value: 'unassigned', label: lang === 'ar' ? 'غير محدد' : 'Unassigned' }];
      case 'order_type': return ORDER_TYPE_OPTIONS.map((value) => ({ value, label: orderTypeLabels[value] || value }));
      case 'payment_method': return PAYMENT_METHOD_OPTIONS.map((value) => ({ value, label: paymentMethodLabels[value] || value }));
      case 'status': return SALE_STATUS_OPTIONS.map((value) => ({ value, label: statusLabels[value] || value }));
      case 'warehouse': return options.warehouses.map((warehouse) => ({ value: warehouse.id, label: warehouse.name }));
      case 'cashier':
      case 'buyer': return options.cashiers.map((user) => ({ value: user.id, label: user.full_name || user.email || '' }));
      case 'customer': return options.customers.map((customer) => ({ value: customer.id, label: name(customer.name, customer.name_en) }));
      case 'supplier': return options.suppliers.map((supplier) => ({ value: supplier.id, label: name(supplier.name, supplier.name_en) }));
      case 'product': return options.products.map((product) => ({ value: product.id, label: name(product.name, product.name_en) }));
      case 'category': return reportType === 'expenses'
        ? options.expenseCategories.map((category) => ({ value: category, label: category }))
        : options.categories.map((category) => ({ value: category.id, label: name(category.name, category.name_en) }));
      case 'table': return options.tables.map((table) => ({ value: table.id, label: table.name }));
    }
  };

  const stationTotals = (rows: Record<string, unknown>[]): Record<string, unknown> => {
    const label = (ar: string, en: string) => lang === 'ar' ? ar : en;
    const keys = [label('الكمية المباعة', 'Sold Quantity'), label('الكمية المرتجعة', 'Returned Quantity'), label('صافي الكمية', 'Net Quantity'), label('المبيعات قبل الخصم', 'Gross Sales'), label('الخصم الموزع', 'Allocated Discount'), label('الضريبة الموزعة', 'Allocated Tax'), label('الإجمالي الأصلي', 'Original Total'), label('قيمة المرتجع', 'Return Value'), label('صافي الإيراد دون الضريبة', 'Net Revenue Excluding Tax'), label('صافي المبيعات', 'Net Sales')];
    const totals: Record<string, unknown> = { [label('الفاتورة', 'Invoice')]: label('الإجمالي', 'Total') };
    for (const key of keys) totals[key] = rows.reduce((sum, row) => sum + Number(row[key] || 0), 0);
    for (const key of [label('التكلفة المسجلة', 'Recorded Cost'), label('مجمل الربح', 'Gross Profit'), label('تكلفة بآخر سعر (تقديرية)', 'Latest Price Cost (Estimated)'), label('تكلفة المكونات المسعرة (تقديرية)', 'Priced Components Cost (Estimated)')]) {
      if (rows.length && key in rows[0]) totals[key] = rows.every(row => typeof row[key] === 'number') ? rows.reduce((sum, row) => sum + Number(row[key]), 0) : label('غير مكتمل', 'Incomplete');
    }
    return totals;
  };

  const handlePrint = (complete: ReportSnapshot, reservedWindow?: Window | null) => {
    const reportLabel = reportTypes.find((row) => row.key === reportType)?.label ?? reportType;
    const headers = columns;
    const rows = complete.rows.map((row) => headers.map((header) => {
      const value = row[header];
      if (typeof value === 'number' && moneyKeys.includes(header)) return formatFinancialCurrency(value, currency, lang);
      return String(value ?? '');
    }));
    if (reportType === 'sales_by_station') { const totals = stationTotals(complete.rows); rows.push(headers.map(header => String(totals[header] ?? ''))); }
    openPrintWindow({ title: reportLabel, subtitle: `${reportBranchLabel} — ${complete.from ?? from} - ${complete.to ?? to}`, headers, rows, lang: lang as 'ar' | 'en' }, reservedWindow);
  };

  const exportComplete = async (kind: 'excel' | 'csv' | 'print') => {
    if (exportingRef.current || loading || reportError || columns.length === 0) return;
    const reservedWindow = kind === 'print' && snapshot?.serverPaged
      ? window.open('', '_blank', 'width=960,height=680') : undefined;
    if (kind === 'print' && snapshot?.serverPaged && !reservedWindow) {
      setExportError(new Error(lang === 'ar' ? 'اسمح بفتح نافذة الطباعة ثم حاول مجددًا' : 'Allow the print popup and retry'));
      return;
    }
    const generation = exportGeneration.current;
    const controller = new AbortController(); exportController.current = controller;
    exportingRef.current = true; setExporting(true); setExportError(null);
    try {
      // This reader captures applied filters/dates, never the edited draft.
      if (snapshot?.serverPaged && snapshot.summary.count > MAX_REPORT_SOURCE_ROWS) throw new Error('REPORT_SOURCE_LIMIT');
      const complete = snapshot?.serverPaged ? await reportSource.read() : snapshot;
      if (generation !== exportGeneration.current || !complete) { reservedWindow?.close(); return; }
      if (kind === 'excel') await handleExportExcel(complete);
      else if (kind === 'csv') handleExportCSV(complete);
      else handlePrint(complete, reservedWindow);
    } catch (failure) {
      reservedWindow?.close();
      if (generation === exportGeneration.current) setExportError(failure);
    } finally {
      if (generation === exportGeneration.current) { exportController.current = null; exportingRef.current = false; setExporting(false); }
    }
  };

  return (
    <div>
      <PageHeader title={workspaceTitle || t('reports')} actions={
        <div className="flex flex-wrap gap-2">
          <ColumnPicker
            columns={allColumns}
            visibleColumns={visibleColumns}
            onToggle={(key) => toggleColumn(key, allColumns)}
            onShowAll={showAllColumns}
            onMove={(key, direction) => moveColumn(key, direction, allColumns)}
            onResetOrder={resetColumnOrder}
            lang={lang}
            hiddenCount={hiddenCount}
          />
          {can('reports.export') && <Button variant="outline" size="sm" onClick={() => void exportComplete('excel')} disabled={!snapshot || loading || exporting || !!reportError || columns.length === 0}><Download className="w-4 h-4" /> {t('exportExcel')}</Button>}
          {can('reports.export') && <Button variant="outline" size="sm" onClick={() => void exportComplete('csv')} disabled={!snapshot || loading || exporting || !!reportError || columns.length === 0}><FileDown className="w-4 h-4" /> {t('exportCsv')}</Button>}
          {can('reports.print') && <Button variant="outline" size="sm" onClick={() => void exportComplete('print')} disabled={!snapshot || loading || exporting || !!reportError || columns.length === 0}><Printer className="w-4 h-4" /> {t('print')}</Button>}
        </div>
      } />

      {exporting && <p role="status" className="mb-3 text-sm">{lang === 'ar' ? 'جاري تجهيز التقرير الكامل…' : 'Preparing complete report…'}</p>}
      {data.length > 0 && columns.length === 0 && <p role="status" className="mb-3 text-sm text-ui-muted">{lang === 'ar' ? 'اختر عمودًا واحدًا على الأقل للعرض والتصدير من قائمة الأعمدة.' : 'Choose at least one column to display and export from Columns.'}</p>}
      {exportError != null && <p role="alert" className="mb-3 text-sm text-ui-danger">{userFacingErrorMessage(exportError, lang)}</p>}
      {!history.unlimited && (
        <div className="mb-3 rounded-xl border border-ui-warning/30 bg-ui-warning-soft px-4 py-3 text-sm text-ui-warning">
          {lang === 'ar'
            ? 'نطاق العرض محدود حسب الصلاحية: آخر 7 أيام تظهر كاملة، وما قبلها يخضع لسياسة العرض التاريخي. الإجماليات والتصدير تشمل فقط البيانات المسموح لك برؤيتها.'
            : 'Visibility is permission-limited: the last 7 days are complete, while older history follows the historical visibility policy. Totals and exports include only data you are allowed to see.'}
        </div>
      )}

      <CustomReportBar
        savedReports={savedReports}
        currentReportType={reportType}
        currentVisibleColumns={visibleColumns}
        currentFilters={filters}
        onSelect={handleRestoreCustomReport}
        onSave={handleSaveCustomReport}
        onDelete={deleteReport}
        lang={lang}
      />

      {!!optionsError && (
        <div role="alert" aria-label={lang === 'ar' ? 'خطأ تحميل الفلاتر' : 'Filter loading error'} className="mb-3 rounded-xl border border-ui-warning/30 bg-ui-warning-soft p-3">
          <p>{lang === 'ar' ? 'تعذر تحميل خيارات الفلاتر.' : 'Filter options could not be loaded.'} {userFacingErrorMessage(optionsError, lang)}</p>
          <Button size="sm" variant="outline" onClick={() => { void retryOptions(); }}>{lang === 'ar' ? 'إعادة تحميل الفلاتر' : 'Retry filters'}</Button>
        </div>
      )}
      <ReportFilterBar
        reportType={reportType}
        filters={filters}
        onFilterChange={(dim, value) => {
          setFilters((prev) => ({ ...prev, [dim]: value }));
          setFiltersDirty(true);
        }}
        showDate={showDate}
        asOfDate={reportType === 'inventory_as_of'}
        period={period}
        onPeriodChange={(key) => applyPeriod(key as PeriodKey)}
        from={from}
        to={to}
        onFromChange={(value) => { setFrom(value); setPeriod('custom'); setFiltersDirty(true); }}
        onToChange={(value) => { setTo(value); setPeriod('custom'); setFiltersDirty(true); }}
        showBranchFilter={false}
        branches={branches}
        branchFilterValue={branchFilter || ''}
        onBranchFilterChange={() => undefined}
        filterOptions={filterOptions}
        filterLabel={filterLabel}
        allLabel={allLabel}
        filterDimensions={REPORT_FILTER_DIMS[reportType]}
        total={summary.total}
        count={summary.count}
        currency={currency}
        lang={lang}
        financialTypes={canFinancial ? financialTypes : []}
        canFinancial={canFinancial}
        onFinancialSelect={(key) => navigate(`/financial-reports?view=${key}&from=${from}&to=${to}`)}
        reportTypes={reportTypes}
        onReportTypeChange={handleReportTypeSelect}
        onRunReport={() => runReport()}
        loading={loading}
        unavailable={!snapshot || !!reportError}
        pendingChanges={filtersDirty}
      />

      {(reportType === 'sales_costs' || reportType === 'sales_by_station') && canStationCost && (
        <div className="mb-3 flex flex-wrap items-center gap-3" data-testid="station-cost-mode">
          <p className="text-sm text-ui-muted">{includeActualCost
            ? (lang === 'ar' ? 'التكلفة الفعلية المسجلة حسب حركات FIFO، منفصلة عن التقديرية.' : 'Recorded FIFO movement cost is shown separately from estimated cost.')
            : (lang === 'ar' ? 'التكلفة المعروضة تقديرية: الكمية × سعر FIFO الحالي أو آخر سعر محفوظ؛ لا تُحمّل حركات FIFO التفصيلية. الخام غير المسعّر يظل بلا سعر ولا يُفترض أن تكلفته صفر.' : 'Default cost is estimated: quantity × current FIFO unit price or last saved price. Detailed FIFO movements are not loaded; unpriced materials are not zero.')}</p>
          <Button variant="outline" size="sm" disabled={!snapshot || loading || filtersDirty} onClick={() => {
            setIncludeActualCost(value => !value);
            setQueryVersion(version => version + 1);
          }}>{includeActualCost ? (lang === 'ar' ? 'عرض التكلفة التقديرية فقط' : 'Show estimated cost only') : (lang === 'ar' ? 'حساب التكلفة الفعلية (FIFO)' : 'Calculate actual cost (FIFO)')}</Button>
        </div>
      )}
      {reportType === 'inventory_as_of' && <p role="note" className="mb-3 text-sm text-ui-muted">{lang === 'ar' ? `أرصدة الخامات من الحركات المسموح لك عرضها حتى نهاية يوم ${snapshot?.to || to} بتوقيت القاهرة. القيمة هي المسجلة في الحركات؛ لا تمثل إعادة تسعير المخزون بأسعار اليوم.` : `Material balances from permitted movements through end of ${snapshot?.to || to} in Cairo. Values are recorded movement costs, not a repricing at today's prices.`}</p>}
      {reportType === 'sales_by_station' && <details className="mb-3 text-xs text-ui-muted"><summary className="cursor-pointer">{lang === 'ar' ? 'تفاصيل حساب المبيعات والتكلفة' : 'Sales and cost calculation details'}</summary><p data-testid="station-sales-source-note">{getReportExcelProfile(reportType, lang).sourceNote}</p></details>}

      {reportType === 'sales_by_product' && <p data-testid="product-sales-source-note" className="mb-3 text-xs text-ui-muted">{getReportExcelProfile(reportType, lang).sourceNote}</p>}
      <Button variant="outline" disabled={loading} onClick={() => runReport(true)}>{lang === 'ar' ? 'تحديث التقرير' : 'Refresh report'}</Button>
      <p className="mb-3 text-xs text-ui-muted">{lang === 'ar' ? 'تتشارك الصفحات النتائج المتطابقة لمدة دقيقة. اضغط تحديث التقرير لطلب أحدث البيانات.' : 'Identical results are shared for up to one minute. Refresh report requests the latest data.'}</p>
      <ReportWorkbench type={reportType} lang={lang} scope={reportReader} userId={user?.id || ''}
        rows={data} complete={!snapshot?.serverPaged} unavailable={!snapshot || loading || !!reportError}
        currency={currency} moneyKeys={moneyKeys} canExport={can('reports.export')} canPrint={can('reports.print')}
        loadRows={async () => { if (snapshot?.serverPaged && snapshot.summary.count > MAX_REPORT_SOURCE_ROWS) throw new Error('REPORT_SOURCE_LIMIT'); return (await reportSource.read()).rows; }}
        period={snapshot?.from && snapshot?.to && reportType !== 'inventory_as_of' && DATE_DRIVEN_REPORTS.has(reportType) ? { from: snapshot.from, to: snapshot.to } : undefined}
        loadComparisonMetrics={['sales', 'purchases', 'expenses'].includes(reportType) ? async range => (await metricSource.read(range)).metrics! : undefined}
        loadComparison={async range => (await reportSource.read(range)).rows}
        onOpen={open => setWorkbenchScope(() => open ? reportReader : null)} />
      {!workbenchActive && (<Card className="p-4 border-ui-border bg-ui-surface shadow-ui">
        {loading ? (
          <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" /></div>
        ) : reportError ? (
          <div role="alert" className="space-y-3 py-12 text-center">
            <p>{userFacingErrorMessage(reportError, lang)}</p>
            <Button variant="outline" onClick={() => { void retryReport(); }}>{lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}</Button>
          </div>
        ) : data.length === 0 ? (
          <div className="text-center py-12 text-ui-subtle text-sm">{snapshot ? t('noData') : (lang === 'ar' ? 'اختر الفترة واضغط عرض التقرير' : 'Choose filters and run the report.')}</div>
        ) : (
          <div>
            <div data-testid="reports-mobile-results" className="space-y-2 sm:hidden">
              {displayedRows.map((row, index) => (
                <article key={resultPageStart + index} className="rounded-xl border border-ui-border bg-ui-surface p-3 shadow-ui-sm">
                  <dl className="divide-y divide-ui-border">
                    {reportMobilePrimaryColumns.map((key) => {
                      const value = row[key];
                      return (
                        <div key={key} className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-3 py-2 first:pt-0 last:pb-0">
                          <dt className="break-words text-xs font-semibold text-ui-muted">{key}</dt>
                          <dd className="break-words text-sm text-ui-text">
                            {typeof value === 'number' && moneyKeys.includes(key) ? formatFinancialCurrency(value, currency, lang) : String(value ?? '')}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                  {reportMobileSecondaryColumns.length > 0 && (
                    <details className="mt-2 rounded-lg border border-ui-border bg-ui-page-alt/50">
                      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-center px-3 text-xs font-bold text-ui-primary">
                        {lang === 'ar' ? 'التفاصيل' : 'Details'} · {reportMobileSecondaryColumns.length}
                      </summary>
                      <dl className="divide-y divide-ui-border border-t border-ui-border px-3">
                        {reportMobileSecondaryColumns.map((key) => {
                          const value = row[key];
                          return (
                            <div key={key} className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-3 py-2">
                              <dt className="break-words text-xs font-semibold text-ui-muted">{key}</dt>
                              <dd className="break-words text-sm text-ui-text">
                                {typeof value === 'number' && moneyKeys.includes(key) ? formatFinancialCurrency(value, currency, lang) : String(value ?? '')}
                              </dd>
                            </div>
                          );
                        })}
                      </dl>
                    </details>
                  )}
                </article>
              ))}
            </div>

            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ui-border">
                    {columns.map((key) => <th key={key} className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{key}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {displayedRows.map((row, index) => (
                    <tr key={resultPageStart + index} className="border-b border-ui-border/60 hover:bg-ui-page-alt">
                      {columns.map((key, columnIndex) => {
                        const value = row[key];
                        return (
                          <td key={columnIndex} className="px-4 py-3 text-ui-text">
                            {typeof value === 'number' && moneyKeys.includes(key) ? formatFinancialCurrency(value, currency, lang) : String(value ?? '')}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
                {reportType === 'sales_by_station' && <tfoot><tr className="border-t border-ui-border font-bold">{columns.map(key => <td key={key} className="px-4 py-3">{typeof stationTotals(data)[key] === 'number' && moneyKeys.includes(key) ? formatFinancialCurrency(Number(stationTotals(data)[key]), currency, lang) : String(stationTotals(data)[key] ?? '')}</td>)}</tr></tfoot>}
              </table>
            </div>
          </div>
        )}
        {!loading && !reportError && rowCount > 100 && (
          <nav aria-label={lang === 'ar' ? 'صفحات التقرير' : 'Report pages'} className="mt-3 flex items-center justify-center gap-3 print:hidden">
            <Button size="sm" variant="outline" disabled={currentResultPage === 0} onClick={() => changePage(currentResultPage - 1)}>{lang === 'ar' ? 'السابق' : 'Previous'}</Button>
            <span>{currentResultPage + 1} / {resultPageCount} · {rowCount}</span>
            <Button size="sm" variant="outline" disabled={currentResultPage + 1 >= resultPageCount} onClick={() => changePage(currentResultPage + 1)}>{lang === 'ar' ? 'التالي' : 'Next'}</Button>
          </nav>
        )}
      </Card>)}
    </div>
  );
}
