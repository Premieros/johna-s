import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowDown, ArrowUp, ArrowUpRight, BarChart3, CreditCard,
  RefreshCw, Wallet, ReceiptText,
  Calculator, ShoppingCart, ChefHat,
  Settings, History as HistoryIcon, Landmark,
} from 'lucide-react';
import { reporting } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useSettings } from '@/context/SettingsContext';
import { useBranches } from '@/hooks/useBranches';
import { useCan } from '@/lib/permissions';
import { useHistoryAccess } from '@/lib/useHistoryAccess';
import { formatFinancialCurrency, formatNumber, formatPercent } from '@/lib/format';
import {
  netSaleAmount,
  netSaleItemQuantity,
  type PaymentMethodAggregate,
} from '@/features/reporting/numericIntegrity';
import { loadDashboardPaymentAggregates } from '../services/dashboardPayments';
import { loadDashboardSalesSnapshot, type DashboardSalesSnapshot } from '../services/dashboardSnapshot';
import { loadDashboardFallbackSales, loadDashboardOpsRows, loadDashboardStockRows } from '../services/dashboardRawData';
import { DashboardStandbyBar } from '../components/DashboardStandbyBar';

import { addIsoDays, businessDateISO } from '@/lib/businessTime';
import { dashboardPeriod, type DashboardRange as Range } from '../utils/dashboardPeriod';
type RelatedName = { name?: string | null; name_en?: string | null; low_stock_threshold?: number | null };
type Sale = {
  id: string;
  invoice_number: string | null;
  total: number | null;
  paid_amount: number | null;
  payment_method: string | null;
  status: string | null;
  branch_id: string | null;
  created_at: string;
  order_type: string | null;
  refunded_amount: number | null;
  discount_amount: number | null;
  branch?: RelatedName | RelatedName[] | null;
};
type StockAlert = { key: string; name: string; quantity: number; threshold: number };
type RawStockMaster = { id: string; branch_id: string | null; name: string; min_stock: number | null; is_active: boolean | null };
type RawStockBalance = { raw_material_id: string; branch_id: string | null; quantity: number | null };
type UnitStockMaster = { id: string; branch_id: string | null; name: string; min_stock: number | null; low_stock_threshold: number | null; is_active: boolean | null };
type UnitStockBatch = { unit_id: string; branch_id: string | null; quantity: number | null };
type SaleItem = { quantity: number | null; refunded_quantity: number | null; product?: RelatedName | RelatedName[] | null };
type Point = { label: string; sales: number; previous: number };
type QuickStats = { expenses: number | null; profit: number | null; lowStockCount: number | null };
type ActiveOrderRow = {
  id: string;
  status: string | null;
  order_type: string | null;
  table_id: string | null;
  branch_id: string | null;
  total: number | null;
  order_items?: Array<{ quantity: number | null }> | null;
};
type DashboardOps = {
  openOrderValue: number;
  purchases: number;
  expenses: number;
};

const rangeLabels: Record<Range, [string, string]> = {
  today: ['اليوم', 'Today'],
  week: ['7 أيام', '7 days'],
  month: ['هذا الشهر', 'This month'],
  previous_month: ['الشهر السابق', 'Previous month'],
  custom: ['فترة محددة', 'Custom period'],
  year: ['السنة', 'Year'],
};
const orderLabels: Record<string, [string, string]> = {
  dine_in: ['الصالة', 'Dine-in'], takeaway: ['تيك أواي', 'Takeaway'], delivery: ['دليفري', 'Delivery'],
  car: ['سيارة', 'Car'], quick: ['سريع', 'Quick'], other: ['أخرى', 'Other'],
};
const paymentLabels: Record<string, [string, string]> = {
  cash: ['نقدي', 'Cash'], card: ['بطاقة', 'Card'], visa: ['فيزا / ماستركارد', 'Visa / Mastercard'],
  bank: ['تحويل بنكي', 'Bank transfer'], instapay: ['InstaPay', 'InstaPay'], wallet: ['محفظة إلكترونية', 'Wallet'],
  split: ['مختلط غير موزع', 'Unallocated split'], other: ['أخرى', 'Other'],
};

const DashboardSalesChart = lazy(() =>
  import('../components/DashboardSalesChart').then((module) => ({
    default: module.DashboardSalesChart,
  })),
);

function relation<T extends RelatedName>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value || undefined;
}

function buildStockAlerts(
  rawMasters: RawStockMaster[],
  rawBalances: RawStockBalance[],
  unitMasters: UnitStockMaster[],
  unitBatches: UnitStockBatch[],
  defaultThreshold: number,
): StockAlert[] {
  const rawQty = new Map<string, number>();
  rawBalances.forEach((row) => {
    const key = `${row.branch_id || ''}:${row.raw_material_id}`;
    rawQty.set(key, (rawQty.get(key) || 0) + Number(row.quantity || 0));
  });

  const unitQty = new Map<string, number>();
  unitBatches.forEach((row) => {
    const key = `${row.branch_id || ''}:${row.unit_id}`;
    unitQty.set(key, (unitQty.get(key) || 0) + Number(row.quantity || 0));
  });

  const rawAlerts = rawMasters
    .filter((row) => row.is_active !== false)
    .map((row) => {
      const key = `${row.branch_id || ''}:${row.id}`;
      return {
        key: `raw:${key}`,
        name: row.name,
        quantity: rawQty.get(key) || 0,
        threshold: Number(row.min_stock ?? defaultThreshold),
      };
    });

  const unitAlerts = unitMasters
    .filter((row) => row.is_active !== false)
    .map((row) => {
      const key = `${row.branch_id || ''}:${row.id}`;
      return {
        key: `unit:${key}`,
        name: row.name,
        quantity: unitQty.get(key) || 0,
        threshold: Number(row.low_stock_threshold ?? row.min_stock ?? defaultThreshold),
      };
    });

  return [...rawAlerts, ...unitAlerts]
    .filter((row) => row.quantity <= row.threshold)
    .sort((a, b) => a.quantity - b.quantity || a.name.localeCompare(b.name));
}


function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`ui-accent-card ui-accent-primary rounded-3xl border border-ui-border bg-ui-surface p-5 shadow-ui ${className}`}>{children}</section>;
}

function Empty({ ar }: { ar: boolean }) {
  return <div className="flex min-h-[120px] items-center justify-center text-sm text-ui-subtle">{ar ? 'لا توجد بيانات فعلية للفترة المحددة' : 'No actual data for the selected period'}</div>;
}

function Metric({ testId, icon: Icon, title, value, display, previous, href, ar, detail }: {
  testId: string; icon: typeof Wallet; title: string; value: number; display: string; previous: number; href?: string; ar: boolean; detail?: ReactNode;
}) {
  const change = previous > 0 ? ((value - previous) / previous) * 100 : null;
  const positive = (change ?? 0) >= 0;
  const content = <>
    <div className="flex items-start justify-between"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-ui-primary-soft text-ui-primary"><Icon className="h-5 w-5" /></div>{href && <ArrowUpRight className="h-4 w-4 text-ui-subtle" />}</div>
    <p className="mt-5 text-sm font-semibold text-ui-muted">{title}</p><p className="mt-1 text-3xl font-extrabold tracking-tight text-ui-text tabular-nums">{display}</p>
    {detail && <div className="mt-2 text-xs font-semibold text-ui-muted">{detail}</div>}
    <div className="mt-2 flex items-center gap-2 text-xs">{change === null ? <span className="text-ui-subtle">—</span> : <span className={`inline-flex items-center gap-0.5 font-bold ${positive ? 'text-ui-success' : 'text-ui-danger'}`}>{positive ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}{formatPercent(Math.abs(change), 1)}</span>}<span className="text-ui-subtle">{ar ? 'مقارنة بالفترة السابقة' : 'vs previous period'}</span></div>
  </>;
  const className = `ui-accent-card ui-accent-primary rounded-3xl border border-ui-border bg-ui-surface p-5 shadow-ui ${href ? 'group transition hover:-translate-y-0.5 hover:shadow-ui-lg' : ''}`;
  if (!href) return <div data-testid={testId} className={className}>{content}</div>;
  return <Link data-testid={testId} to={href} className={className}>{content}</Link>;
}

export function DashboardDataPage() {
  const { lang } = useLanguage();
  const can = useCan();
  const history = useHistoryAccess();
  const branchFilter = useBranchFilter();
  const { effectiveSettings } = useSettings();
  const { branches } = useBranches();
  const ar = lang === 'ar';
  const canCreateSale = can('pos.view') && can('pos.order.create');
  const canViewPos = can('pos.view');
  const canViewSales = can('sales.view') || can('reports.view');
  const canViewReports = can('reports.view');
  const canViewInventory = can('inventory.view');
  const canViewFloorPlan = can('floor_plan.view');
  const canViewPurchases = can('purchases.view');
  const canViewExpenses = can('expenses.view');
  const canViewKds = can('pos.kds_view');
  const canViewFinancial = can('reports.financial');
  const canViewAudit = can('audit.view');
  const canViewSettings = can('settings.manage');
  const canViewTreasury = can('accounts.view');
  const [range, setRange] = useState<Range>('today');
  const [customDates, setCustomDates] = useState(() => ({ from: businessDateISO(), to: businessDateISO() }));
  const [draftDates, setDraftDates] = useState(customDates);
  const [customOpen, setCustomOpen] = useState(false);
  const [dateError, setDateError] = useState(false);
  const loadId = useRef(0);
  const window = useMemo(() => dashboardPeriod(range, customDates), [range, customDates]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<DashboardSalesSnapshot | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [previousSales, setPreviousSales] = useState<Sale[]>([]);
  const [paymentAggregates, setPaymentAggregates] = useState<PaymentMethodAggregate[]>([]);
  const [previousPaymentAggregates, setPreviousPaymentAggregates] = useState<PaymentMethodAggregate[]>([]);
  const [stockAlerts, setStockAlerts] = useState<StockAlert[]>([]);
  const [items, setItems] = useState<SaleItem[]>([]);
  const [quickStats, setQuickStats] = useState<QuickStats>({ expenses: null, profit: null, lowStockCount: null });
  const [ops, setOps] = useState<DashboardOps>({
    openOrderValue: 0,
    purchases: 0,
    expenses: 0,
  });
  const settings = effectiveSettings(branchFilter);
  const money = useCallback((value: number) => formatFinancialCurrency(value, settings?.currency || 'EGP', lang), [settings?.currency, lang]);

  const load = useCallback(async () => {
    const requestId = ++loadId.current;
    setRefreshing(true);
    setLoading(true);
    setError(null);
    if (!canViewSales) {
      setSnapshot(null);
      setSales([]);
      setPreviousSales([]);
      setPaymentAggregates([]);
      setPreviousPaymentAggregates([]);
      setItems([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const effectiveRange: Range = range;
    const boundedSnapshot = await loadDashboardSalesSnapshot({
      branchId: branchFilter || null,
      currentFrom: window.start.toISOString(),
      currentTo: window.end.toISOString(),
      previousFrom: window.previousStart.toISOString(),
      previousTo: window.previousEnd.toISOString(),
      granularity: effectiveRange === 'today' ? 'hour' : effectiveRange === 'year' ? 'month' : 'day',
      timezone: 'Africa/Cairo',
    }).catch(() => null);

    if (requestId !== loadId.current) return;
    if (boundedSnapshot) {
      setSnapshot(boundedSnapshot);
      setSales([]);
      setPreviousSales([]);
      setItems([]);
      setPaymentAggregates(boundedSnapshot.paymentMethods);
      setPreviousPaymentAggregates(boundedSnapshot.previousPaymentMethods);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    setSnapshot(null);
    const fallback = await loadDashboardFallbackSales({
      branchId: branchFilter || null,
      currentFrom: window.start.toISOString(),
      currentTo: window.end.toISOString(),
      previousFrom: window.previousStart.toISOString(),
      previousTo: window.previousEnd.toISOString(),
    });
    if (requestId !== loadId.current) return;
    const currentRows = fallback.currentRows as Sale[];
    const previousRows = fallback.previousRows as Sale[];
    setSales(currentRows);
    setPreviousSales(previousRows);
    if (fallback.currentErrorMessage) setError(ar ? 'تعذر تحميل بيانات المبيعات. أعد المحاولة.' : 'Sales data could not be loaded. Please retry.');

    const paymentResults = await Promise.allSettled([
      loadDashboardPaymentAggregates({
        sales: currentRows,
        from: window.start.toISOString(),
        to: window.end.toISOString(),
      }),
      loadDashboardPaymentAggregates({
        sales: previousRows,
        from: window.previousStart.toISOString(),
        to: window.previousEnd.toISOString(),
      }),
    ]);
    if (requestId !== loadId.current) return;
    const currentPaymentResult = paymentResults[0];
    const previousPaymentResult = paymentResults[1];
    setPaymentAggregates(currentPaymentResult.status === 'fulfilled' ? currentPaymentResult.value : []);
    setPreviousPaymentAggregates(previousPaymentResult.status === 'fulfilled' ? previousPaymentResult.value : []);
    if (paymentResults.some((result) => result.status === 'rejected')) {
      setError(ar ? 'تعذر تحميل تفاصيل طرق الدفع. أعد المحاولة.' : 'Payment-method details could not be loaded. Please retry.');
    }
    setItems(fallback.itemRows as SaleItem[]);

    setLoading(false);
    setRefreshing(false);
  }, [ar, branchFilter, range, window, canViewSales]);

  useEffect(() => { void load(); return () => { loadId.current += 1; }; }, [load]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stock = await loadDashboardStockRows({ enabled: canViewInventory, branchId: branchFilter || null });
      if (cancelled) return;
      const alerts = stock.failed ? [] : buildStockAlerts(
        stock.rawMasters as RawStockMaster[], stock.rawBalances as RawStockBalance[],
        stock.unitMasters as UnitStockMaster[], stock.unitBatches as UnitStockBatch[],
        Number(settings?.low_stock_threshold ?? 5),
      );
      setStockAlerts(alerts);
      setQuickStats((current) => ({ ...current, lowStockCount: stock.failed ? null : alerts.length }));
    })();
    return () => { cancelled = true; };
  }, [branchFilter, settings?.low_stock_threshold, canViewInventory]);

  useEffect(() => {
    let cancelled = false;
    setQuickStats((current) => ({ ...current, expenses: null, profit: null }));
    void (async () => {
      const targetBranches = branchFilter ? branches.filter((branch) => branch.id === branchFilter) : branches;
      const statements = canViewFinancial
        ? await Promise.all(targetBranches.map((branch) => reporting.getIncomeStatement({ p_branch_id: branch.id, p_from_date: window.from, p_to_date: window.to })))
        : [];
      if (cancelled) return;
      const validStatements = statements.filter((result) => !result.error && result.data);
      const expenses = canViewFinancial && targetBranches.length && validStatements.length === targetBranches.length ? validStatements.reduce((sum, result) => sum + Number(result.data?.expenses || 0), 0) : null;
      const profit = canViewFinancial && targetBranches.length && validStatements.length === targetBranches.length ? validStatements.reduce((sum, result) => sum + Number(result.data?.net_income || 0), 0) : null;
      setQuickStats((current) => ({ ...current, expenses, profit }));
    })();
    return () => { cancelled = true; };
  }, [branchFilter, branches, window, canViewFinancial]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
        const fromIso = window.start.toISOString();
      const fromDate = window.from;

      const data = await loadDashboardOpsRows({
        branchId: branchFilter || null,
        fromIso,
        fromDate,
        toIso: window.end.toISOString(),
        toDate: window.to,
        includePos: canViewPos,
        includePurchases: canViewPurchases,
        includeExpenses: canViewExpenses,
      });
      if (cancelled) return;

      const activeOrders = (data.orders as ActiveOrderRow[]).filter((order) =>
        (order.order_items || []).some((item) => Number(item.quantity || 0) > 0),
      );
      setOps({
        openOrderValue: activeOrders.reduce((sum, order) => sum + Math.max(0, Number(order.total || 0)), 0),
        purchases: data.purchases.reduce((sum, row) => sum + Math.max(0, Number(row.total || 0) - Number(row.returned_amount || 0)), 0),
        expenses: data.expenses.reduce((sum, row) => sum + Number(row.amount || 0), 0),
      });
    })();

    return () => { cancelled = true; };
  }, [
    branchFilter, window,
    canViewPos, canViewPurchases, canViewExpenses,
  ]);

  const current = useMemo(() => {
    if (snapshot) return snapshot.current;
    const methods = paymentAggregates;
    return {
      orders: sales.length,
      sales: sales.reduce((sum, sale) => sum + netSaleAmount(sale), 0),
      payments: methods.reduce((sum, row) => sum + row.total, 0),
      returns: sales.reduce((sum, sale) => sum + Number(sale.refunded_amount || 0), 0),
      discounts: sales.reduce((sum, sale) => sum + Number(sale.discount_amount || 0), 0),
    };
  }, [sales, paymentAggregates, snapshot]);
  const previous = useMemo(() => {
    if (snapshot) return snapshot.previous;
    const methods = previousPaymentAggregates;
    return {
      orders: previousSales.length,
      sales: previousSales.reduce((sum, sale) => sum + netSaleAmount(sale), 0),
      payments: methods.reduce((sum, row) => sum + row.total, 0),
      returns: previousSales.reduce((sum, sale) => sum + Number(sale.refunded_amount || 0), 0),
      discounts: previousSales.reduce((sum, sale) => sum + Number(sale.discount_amount || 0), 0),
    };
  }, [previousSales, previousPaymentAggregates, snapshot]);
  const paymentRows = useMemo(() => paymentAggregates.slice(0, 5), [paymentAggregates]);
  const orderRows = useMemo(() => {
    if (snapshot) return snapshot.orderTypes.map((row) => [row.key, row.count] as [string, number]);
    const map = new Map<string, number>();
    sales.forEach((sale) => map.set(sale.order_type || 'other', (map.get(sale.order_type || 'other') || 0) + 1));
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [sales, snapshot]);
  const productRows = useMemo(() => {
    if (snapshot) return snapshot.topProducts.map((row) => [row.name, row.quantity] as [string, number]);
    const map = new Map<string, number>();
    items.forEach((item) => {
      const product = relation(item.product);
      const name = product?.name || (ar ? 'غير محدد' : 'Unknown');
      map.set(name, (map.get(name) || 0) + netSaleItemQuantity(item));
    });
    return [...map.entries()].filter(([, qty]) => qty > 0).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [ar, items, snapshot]);
  const branchRows = useMemo(() => {
    if (snapshot) {
      return snapshot.branches.map((row) => {
        const branch = branches.find((item) => item.id === row.branchId);
        const name = ar ? branch?.name || 'غير محدد' : branch?.name_en || branch?.name || 'Unknown';
        return [name, { orders: row.orders, sales: row.sales }] as [string, { orders: number; sales: number }];
      });
    }
    const map = new Map<string, { orders: number; sales: number }>();
    sales.forEach((sale) => {
      const branch = relation(sale.branch);
      const name = ar ? branch?.name || 'غير محدد' : branch?.name_en || branch?.name || 'Unknown';
      const row = map.get(name) || { orders: 0, sales: 0 };
      row.orders += 1; row.sales += netSaleAmount(sale); map.set(name, row);
    });
    return [...map.entries()].sort((a, b) => b[1].sales - a[1].sales).slice(0, 5);
  }, [ar, branches, sales, snapshot]);
  const lowStock = useMemo(() => stockAlerts.slice(0, 5), [stockAlerts]);

  const chart = useMemo<Point[]>(() => {
    const effectiveRange: Range = range;
    const currentMap = new Map<string, number>();
    const previousMap = new Map<string, number>();
    const key = (date: Date) => effectiveRange === 'today' ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', hourCycle: 'h23' }).format(date).replace(/^0/, '') || '0' : effectiveRange === 'year' ? String(Number(businessDateISO(date).slice(5, 7)) - 1) : businessDateISO(date);
    if (snapshot) {
      const snapshotKey = (bucket: string) => effectiveRange === 'today'
        ? String(Number(bucket.slice(11, 13)))
        : effectiveRange === 'year'
        ? String(Math.max(0, Number(bucket.slice(5, 7)) - 1))
        : bucket.slice(0, 10);
      snapshot.currentSeries.forEach((row) => currentMap.set(snapshotKey(row.bucket), row.sales));
      snapshot.previousSeries.forEach((row) => previousMap.set(snapshotKey(row.bucket), row.sales));
    } else {
      sales.forEach((sale) => currentMap.set(key(new Date(sale.created_at)), (currentMap.get(key(new Date(sale.created_at))) || 0) + netSaleAmount(sale)));
      previousSales.forEach((sale) => previousMap.set(key(new Date(sale.created_at)), (previousMap.get(key(new Date(sale.created_at))) || 0) + netSaleAmount(sale)));
    }
    if (effectiveRange === 'today') return Array.from({ length: 24 }, (_, hour) => ({ label: `${String(hour).padStart(2, '0')}:00`, sales: currentMap.get(String(hour)) || 0, previous: previousMap.get(String(hour)) || 0 }));
    if (effectiveRange === 'year') return Array.from({ length: 12 }, (_, month) => ({ label: new Date(window.start.getFullYear(), month, 1).toLocaleDateString(ar ? 'ar-EG' : 'en-US', { month: 'short' }), sales: currentMap.get(String(month)) || 0, previous: previousMap.get(String(month)) || 0 }));
    const dayCount = window.dayCount;
    return Array.from({ length: dayCount }, (_, index) => {
      const dateKey = addIsoDays(window.from, index);
      const previousKey = addIsoDays(window.previousFrom, index);
      const date = new Date(`${dateKey}T12:00:00Z`);
      return { label: date.toLocaleDateString(ar ? 'ar-EG' : 'en-US', { day: 'numeric', month: 'short', timeZone: 'Africa/Cairo' }), sales: currentMap.get(dateKey) || 0, previous: previousMap.get(previousKey) || 0 };
    });
  }, [ar, previousSales, range, window, sales, snapshot]);

  const quick = (value: number | null, formatter: (value: number) => string) => value === null ? '—' : formatter(value);
  const recent = snapshot ? snapshot.recentSales : sales.slice(0, 5);

  return <div dir={ar ? 'rtl' : 'ltr'} className="min-h-[calc(100vh-64px)] w-full min-w-0 bg-ui-page py-3 sm:py-4" data-testid="dashboard-surface"><div className="w-full min-w-0 space-y-5">
    <DashboardStandbyBar canCreateSale={canCreateSale} />

    <section className="rounded-[32px] bg-gradient-to-br from-[#24114f] via-[#4b20a9] to-[#6d35df] p-6 text-white shadow-ui-lg"><div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between"><div><div className="flex items-center gap-2 text-white/80"><BarChart3 className="h-4 w-4" /><span className="text-xs font-bold uppercase tracking-[0.18em]">Premier Control</span></div><h2 className="mt-2 text-3xl font-black">{ar ? 'لوحة التحكم' : 'Dashboard'}</h2><p className="mt-1 text-sm text-white/70">{history.unlimited ? (ar ? 'عرض كامل للتاريخ حسب الصلاحية' : 'Full historical access enabled') : (ar ? 'آخر 7 أيام كاملة، وما قبلها حسب سياسة العرض' : 'Last 7 days are complete; older periods follow the visibility policy')}</p></div><div className="flex flex-wrap gap-2">{(Object.keys(rangeLabels) as Range[]).map((item) => <button key={item} data-testid={`dashboard-range-${item}`} aria-pressed={range === item} onClick={() => { if (item === 'custom') { setDraftDates(customDates); setDateError(false); setCustomOpen(true); } else { setRange(item); setCustomOpen(false); } }} className={`rounded-xl px-4 py-2 text-sm font-bold ${range === item ? 'bg-white text-ui-primary' : 'bg-white/10 text-white'}`}>{rangeLabels[item][ar ? 0 : 1]}</button>)}<button onClick={() => void load()} className="rounded-xl bg-white/10 p-2" aria-label={ar ? 'تحديث' : 'Refresh'}><RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /></button></div></div></section>

    {customOpen && <section data-testid="dashboard-custom-period" className="rounded-2xl border border-ui-border bg-ui-surface p-4">
      <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => {
        event.preventDefault();
        try { dashboardPeriod('custom', draftDates); }
        catch { setDateError(true); return; }
        setCustomDates({ ...draftDates }); setRange('custom'); setCustomOpen(false); setDateError(false);
      }}>
        <label className="text-sm font-bold text-ui-text">{ar ? 'من تاريخ' : 'From date'}<input data-testid="dashboard-custom-from" type="date" required value={draftDates.from} onChange={(event) => setDraftDates({ ...draftDates, from: event.target.value })} className="mt-1 block rounded-xl border border-ui-border bg-ui-page p-2" /></label>
        <label className="text-sm font-bold text-ui-text">{ar ? 'إلى تاريخ' : 'To date'}<input data-testid="dashboard-custom-to" type="date" required min={draftDates.from} value={draftDates.to} onChange={(event) => setDraftDates({ ...draftDates, to: event.target.value })} className="mt-1 block rounded-xl border border-ui-border bg-ui-page p-2" /></label>
        <button type="submit" className="rounded-xl bg-ui-primary px-4 py-2 font-bold text-ui-primary-fg">{ar ? 'تطبيق' : 'Apply'}</button>
        <button type="button" onClick={() => setCustomOpen(false)} className="rounded-xl border border-ui-border px-4 py-2 text-ui-text">{ar ? 'إلغاء' : 'Cancel'}</button>
        {dateError && <p role="alert" className="text-sm text-ui-danger">{ar ? 'أدخل فترة صحيحة؛ تاريخ النهاية لا يسبق البداية.' : 'Enter a valid period; end date must not precede start date.'}</p>}
      </form>
    </section>}
    <p data-testid="dashboard-selected-dates" className="text-sm font-bold text-ui-muted">{window.from} — {window.to}</p>

    {error && <div className="rounded-2xl border border-ui-danger/30 bg-ui-danger-soft p-4 text-sm font-bold text-ui-danger">{error}</div>}

    {(canViewSales || canViewFinancial || canViewInventory) && <Card><div className="mb-4"><h2 className="text-lg font-black text-ui-text">{ar ? `ملخص ${rangeLabels[range][0]}` : `${rangeLabels[range][1]} summary`}</h2><p className="text-xs text-ui-subtle">{ar ? 'المبيعات صافية بعد المرتجعات، والربح من قائمة الدخل المحاسبية' : 'Sales are net of refunds; profit comes from the accounting income statement'}</p></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {canViewFinancial && <div className="ui-accent-top ui-accent-finance rounded-2xl border border-ui-border bg-ui-surface p-4"><p className="text-xs text-ui-subtle">{ar ? 'المصروفات المحاسبية' : 'Accounting expenses'}</p><p className="mt-2 text-xl font-black text-ui-text">{quick(quickStats.expenses, money)}</p></div>}
      {canViewFinancial && <div className="ui-accent-top ui-accent-inventory rounded-2xl border border-ui-border bg-ui-surface p-4"><p className="text-xs text-ui-subtle">{ar ? 'صافي الربح المحاسبي' : 'Accounting net profit'}</p><p className="mt-2 text-xl font-black text-ui-text">{quick(quickStats.profit, money)}</p></div>}
      {canViewInventory && <div className="ui-accent-top ui-accent-inventory rounded-2xl border border-ui-border bg-ui-surface p-4"><p className="text-xs text-ui-subtle">{ar ? 'تنبيهات المخزون' : 'Low stock alerts'}</p><p className="mt-2 text-xl font-black text-ui-text">{quick(quickStats.lowStockCount, (value) => formatNumber(value, 0))}</p></div>}
    </div></Card>}

    {loading ? <div className="flex h-64 items-center justify-center rounded-3xl border border-ui-border bg-ui-surface"><RefreshCw className="h-7 w-7 animate-spin text-ui-primary" /></div> : <>
      <section data-testid="dashboard-permission-kpis" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {canViewPos && <Metric testId="kpi-open-order-value" icon={Wallet} title={ar ? 'قيمة الطلبات المفتوحة' : 'Open order value'} value={ops.openOrderValue} display={money(ops.openOrderValue)} previous={0} href={canViewFloorPlan ? '/floor-plan' : undefined} ar={ar} />}
        {canViewSales && <Metric testId="kpi-orders" icon={ReceiptText} title={ar ? 'إجمالي الطلبات' : 'Total orders'} value={current.orders} display={formatNumber(current.orders, 0)} previous={previous.orders} href={canViewReports ? '/reports?reportType=detailed_invoices' : undefined} ar={ar} />}
        {canViewSales && <Metric testId="kpi-average-order" icon={Calculator} title={ar ? 'متوسط قيمة الطلب' : 'Average order'} value={current.orders ? current.sales / current.orders : 0} display={money(current.orders ? current.sales / current.orders : 0)} previous={previous.orders ? previous.sales / previous.orders : 0} href={canViewReports ? '/reports?reportType=sales' : undefined} ar={ar} />}
        {canViewSales && <Metric testId="kpi-net-payments" icon={CreditCard} title={ar ? 'صافي المدفوعات' : 'Net payments'} value={current.payments} display={money(current.payments)} previous={previous.payments} href={canViewReports ? '/reports?reportType=sales_by_payment' : undefined} ar={ar} />}
        {canViewSales && <Metric testId="kpi-discounts" icon={Calculator} title={ar ? 'الخصومات' : 'Discounts'} value={current.discounts} display={money(current.discounts)} previous={previous.discounts} href={canViewReports ? '/reports?reportType=sales' : undefined} ar={ar} />}
        {canViewSales && <Metric testId="kpi-returns" icon={ReceiptText} title={ar ? 'المرتجعات' : 'Returns'} value={current.returns} display={money(current.returns)} previous={previous.returns} href={canViewReports ? '/reports?reportType=returns' : undefined} ar={ar} />}
        {canViewPurchases && <Metric testId="kpi-purchases" icon={ShoppingCart} title={ar ? 'المشتريات' : 'Purchases'} value={ops.purchases} display={money(ops.purchases)} previous={0} href="/purchases" ar={ar} />}
        {canViewExpenses && <Metric testId="kpi-expenses" icon={Wallet} title={ar ? 'المصروفات' : 'Expenses'} value={ops.expenses} display={money(ops.expenses)} previous={0} href="/expenses" ar={ar} />}
      </section>

      {canViewReports && canViewSales && <section className="grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.8fr)]"><Card><h2 className="text-lg font-black text-ui-text">{ar ? 'حركة صافي المبيعات' : 'Net sales performance'}</h2><div className="mt-4 h-72">{current.orders > 0 ? <Suspense fallback={<div className="flex h-full items-center justify-center"><RefreshCw className="h-5 w-5 animate-spin text-ui-primary" /></div>}><DashboardSalesChart data={chart} formatValue={money} /></Suspense> : <Empty ar={ar} />}</div></Card>
      <div className="grid gap-5"><Card><h2 className="font-black text-ui-text">{ar ? 'أنواع الطلبات' : 'Order types'}</h2><div className="mt-3 space-y-3">{orderRows.length ? orderRows.map(([key, count]) => <div key={key} className="flex justify-between text-sm"><span className="text-ui-muted">{orderLabels[key]?.[ar ? 0 : 1] || key}</span><b className="text-ui-text">{formatNumber(count, 0)}</b></div>) : <Empty ar={ar} />}</div></Card>
      <Card><h2 className="font-black text-ui-text">{ar ? 'طرق الدفع' : 'Payment methods'}</h2><div className="mt-3 space-y-3">{paymentRows.length ? paymentRows.map((row) => <div key={`${row.branchId}-${row.method}`} className="flex justify-between gap-3 text-sm"><span className="text-ui-muted">{paymentLabels[row.method]?.[ar ? 0 : 1] || row.method}</span><b className="text-ui-text">{money(row.total)}</b></div>) : <Empty ar={ar} />}</div></Card></div></section>}

      {canViewSales && <section className="grid gap-5 xl:grid-cols-3">{can('branches.manage') && <Card><h2 className="mb-3 font-black text-ui-text">{ar ? 'الفروع حسب صافي المبيعات' : 'Branches by net sales'}</h2>{branchRows.length ? branchRows.map(([name, row]) => <div key={name} className="mb-3 flex justify-between gap-3 text-sm"><span className="font-semibold text-ui-text">{name}</span><span className="text-ui-muted">{formatNumber(row.orders, 0)} · {money(row.sales)}</span></div>) : <Empty ar={ar} />}</Card>}
      <Card><h2 className="mb-3 font-black text-ui-text">{ar ? 'أكثر الأصناف مبيعًا' : 'Top selling items'}</h2>{productRows.length ? productRows.map(([name, qty]) => <div key={name} className="mb-3 flex justify-between gap-3 text-sm"><span className="font-semibold text-ui-text">{name}</span><span className="text-ui-muted">{formatNumber(qty, 2)}</span></div>) : <Empty ar={ar} />}</Card>
      <Card><h2 className="mb-3 font-black text-ui-text">{ar ? 'أحدث الطلبات' : 'Recent orders'}</h2>{recent.length ? recent.map((sale) => <div key={sale.id} className="mb-3 flex justify-between gap-3 text-sm"><span className="font-semibold text-ui-text">{sale.invoice_number || '—'}</span><span className="text-ui-muted">{money(netSaleAmount(sale))}</span></div>) : <Empty ar={ar} />}</Card></section>}

      {(canViewKds || canViewTreasury || canViewAudit || canViewSettings) && (
        <section data-testid="dashboard-permission-shortcuts" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {canViewKds && <Link to="/kitchen-display" className="ui-accent-card ui-accent-system rounded-2xl border border-ui-border bg-ui-surface p-4 font-extrabold text-ui-text shadow-ui-sm"><ChefHat className="mb-2 h-5 w-5 text-ui-primary" />{ar ? 'شاشة المطبخ' : 'Kitchen display'}</Link>}
          {canViewTreasury && <Link to="/treasury" className="ui-accent-card ui-accent-finance rounded-2xl border border-ui-border bg-ui-surface p-4 font-extrabold text-ui-text shadow-ui-sm"><Landmark className="mb-2 h-5 w-5 text-ui-primary" />{ar ? 'الخزينة' : 'Treasury'}</Link>}
          {canViewAudit && <Link to="/audit-log" className="ui-accent-card ui-accent-neutral rounded-2xl border border-ui-border bg-ui-surface p-4 font-extrabold text-ui-text shadow-ui-sm"><HistoryIcon className="mb-2 h-5 w-5 text-ui-primary" />{ar ? 'سجل العمليات' : 'Audit log'}</Link>}
          {canViewSettings && <Link to="/settings" className="ui-accent-card ui-accent-system rounded-2xl border border-ui-border bg-ui-surface p-4 font-extrabold text-ui-text shadow-ui-sm"><Settings className="mb-2 h-5 w-5 text-ui-primary" />{ar ? 'الإعدادات' : 'Settings'}</Link>}
        </section>
      )}

      {canViewInventory && lowStock.length > 0 && <Card className="ui-accent-alert border-ui-warning/30"><div className="mb-3 flex items-center gap-2 font-black text-ui-warning"><AlertTriangle className="h-5 w-5" />{ar ? 'تنبيه المخزون المنخفض' : 'Low stock alert'}</div><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">{lowStock.map((row) => <Link key={row.key} to="/inventory" className="rounded-xl bg-ui-page-alt p-3"><p className="truncate text-sm font-bold text-ui-text">{row.name || '—'}</p><p className="mt-1 text-xs text-ui-warning">{formatNumber(row.quantity, 3)} / {formatNumber(row.threshold, 3)}</p></Link>)}</div></Card>}
    </>}
  </div></div>;
}
