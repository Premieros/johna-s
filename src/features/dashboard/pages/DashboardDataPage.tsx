import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowDown, ArrowUp, ArrowUpRight, BarChart3, CreditCard,
  RefreshCw, Wallet, ReceiptText,
  Calculator, ShoppingCart, ChefHat,
  Settings, History as HistoryIcon, Landmark,
} from 'lucide-react';
import { reporting, supabase } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useSettings } from '@/context/SettingsContext';
import { useBranches } from '@/hooks/useBranches';
import { useCan } from '@/lib/permissions';
import { useHistoryAccess } from '@/lib/useHistoryAccess';
import { formatFinancialCurrency, formatNumber, formatPercent } from '@/lib/format';
import {
  aggregatePaymentMethods,
  netSaleAmount,
  netSaleItemQuantity,
  type SalePaymentLike,
} from '@/features/reporting/numericIntegrity';
import { DashboardStandbyBar } from '../components/DashboardStandbyBar';

type Range = 'today' | 'week' | 'month' | 'year';
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
  month: ['الشهر', 'Month'],
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

function periodWindow(range: Range) {
  const now = new Date();
  const end = new Date(now);
  let start: Date;
  let previousStart: Date;
  let previousEnd: Date;

  if (range === 'today') {
    start = new Date(now); start.setHours(0, 0, 0, 0);
    previousStart = new Date(start); previousStart.setDate(previousStart.getDate() - 1);
    previousEnd = new Date(end); previousEnd.setDate(previousEnd.getDate() - 1);
  } else if (range === 'week') {
    start = new Date(now); start.setDate(start.getDate() - 6); start.setHours(0, 0, 0, 0);
    previousEnd = new Date(start); previousEnd.setMilliseconds(-1);
    previousStart = new Date(start); previousStart.setDate(previousStart.getDate() - 7);
  } else if (range === 'month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevLastDay = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
    previousEnd = new Date(now.getFullYear(), now.getMonth() - 1, Math.min(now.getDate(), prevLastDay), now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
  } else {
    start = new Date(now.getFullYear(), 0, 1);
    previousStart = new Date(now.getFullYear() - 1, 0, 1);
    previousEnd = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
  }
  return { start, end, previousStart, previousEnd };
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
  const [range, setRange] = useState<Range>(() => history.unlimited ? 'month' : 'week');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [previousSales, setPreviousSales] = useState<Sale[]>([]);
  const [salePayments, setSalePayments] = useState<SalePaymentLike[]>([]);
  const [previousSalePayments, setPreviousSalePayments] = useState<SalePaymentLike[]>([]);
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
    setRefreshing(true);
    setError(null);
    if (!canViewSales) {
      setSales([]);
      setPreviousSales([]);
      setSalePayments([]);
      setPreviousSalePayments([]);
      setItems([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const effectiveRange: Range = history.unlimited ? range : (range === 'today' ? 'today' : 'week');
    const window = periodWindow(effectiveRange);
    const fields = 'id,invoice_number,total,paid_amount,payment_method,status,branch_id,created_at,order_type,refunded_amount,discount_amount,branch:branches(name,name_en)';
    const previousFields = 'id,total,paid_amount,payment_method,branch_id,created_at,refunded_amount,discount_amount';
    let currentQuery = supabase.from('sales').select(fields).gte('created_at', window.start.toISOString()).lte('created_at', window.end.toISOString()).order('created_at', { ascending: false }).limit(5000);
    let previousQuery = supabase.from('sales').select(previousFields).gte('created_at', window.previousStart.toISOString()).lte('created_at', window.previousEnd.toISOString()).order('created_at', { ascending: false }).limit(5000);
    if (branchFilter) {
      currentQuery = currentQuery.eq('branch_id', branchFilter);
      previousQuery = previousQuery.eq('branch_id', branchFilter);
    }

    const [currentResult, previousResult] = await Promise.all([currentQuery, previousQuery]);
    const currentRows = currentResult.error ? [] : ((currentResult.data || []) as unknown as Sale[]);
    const previousRows = previousResult.error ? [] : ((previousResult.data || []) as unknown as Sale[]);
    setSales(currentRows);
    setPreviousSales(previousRows);
    if (currentResult.error) setError(ar ? 'تعذر تحميل بيانات المبيعات. أعد المحاولة.' : 'Sales data could not be loaded. Please retry.');

    const ids = [...currentRows, ...previousRows].map((sale) => sale.id);
    const paymentPromise = ids.length
      ? supabase.from('sale_payments').select('sale_id,branch_id,payment_method,amount,refunded_amount').in('sale_id', ids).limit(20000)
      : Promise.resolve({ data: [], error: null });
    const itemPromise = currentRows.length
      ? supabase.from('sale_items').select('quantity,refunded_quantity,product:products(name)').in('sale_id', currentRows.map((sale) => sale.id)).limit(20000)
      : Promise.resolve({ data: [], error: null });

    // Payment and item details are independent once sale ids are known.
    // Load them together instead of serially extending dashboard latency.
    const [paymentResult, itemResult] = await Promise.all([paymentPromise, itemPromise]);
    const details = paymentResult.error ? [] : ((paymentResult.data || []) as SalePaymentLike[]);
    const currentIds = new Set(currentRows.map((sale) => sale.id));
    const previousIds = new Set(previousRows.map((sale) => sale.id));
    setSalePayments(details.filter((payment) => currentIds.has(payment.sale_id)));
    setPreviousSalePayments(details.filter((payment) => previousIds.has(payment.sale_id)));
    setItems(itemResult.error ? [] : ((itemResult.data || []) as unknown as SaleItem[]));

    setLoading(false);
    setRefreshing(false);
  }, [ar, branchFilter, range, history.unlimited, canViewSales]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    void (async () => {
      const now = new Date();
      let rawMasterQuery = canViewInventory ? supabase.from('raw_materials').select('id,branch_id,name,min_stock,is_active').eq('is_active', true) : null;
      let rawBalanceQuery = canViewInventory ? supabase.from('raw_material_inventory').select('raw_material_id,branch_id,quantity') : null;
      let unitMasterQuery = canViewInventory ? supabase.from('inventory_units').select('id,branch_id,name,min_stock,low_stock_threshold,is_active').eq('is_active', true) : null;
      let unitBatchQuery = canViewInventory ? supabase.from('inventory_unit_batches').select('unit_id,branch_id,quantity') : null;
      if (branchFilter) {
        if (rawMasterQuery) rawMasterQuery = rawMasterQuery.eq('branch_id', branchFilter);
        if (rawBalanceQuery) rawBalanceQuery = rawBalanceQuery.eq('branch_id', branchFilter);
        if (unitMasterQuery) unitMasterQuery = unitMasterQuery.eq('branch_id', branchFilter);
        if (unitBatchQuery) unitBatchQuery = unitBatchQuery.eq('branch_id', branchFilter);
      }
      const [rawMastersResult, rawBalancesResult, unitMastersResult, unitBatchesResult] = await Promise.all([
        rawMasterQuery ?? Promise.resolve({ data: [], error: null }),
        rawBalanceQuery ?? Promise.resolve({ data: [], error: null }),
        unitMasterQuery ?? Promise.resolve({ data: [], error: null }),
        unitBatchQuery ?? Promise.resolve({ data: [], error: null }),
      ]);
      const stockQueryFailed = !canViewInventory || Boolean(rawMastersResult.error || rawBalancesResult.error || unitMastersResult.error || unitBatchesResult.error);
      const alerts = stockQueryFailed ? [] : buildStockAlerts(
        (rawMastersResult.data || []) as RawStockMaster[],
        (rawBalancesResult.data || []) as RawStockBalance[],
        (unitMastersResult.data || []) as UnitStockMaster[],
        (unitBatchesResult.data || []) as UnitStockBatch[],
        Number(settings?.low_stock_threshold ?? 5),
      );
      setStockAlerts(alerts);
      const lowStockCount = stockQueryFailed ? null : alerts.length;
      const from = history.unlimited
        ? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
        : (history.minDate || now.toISOString().slice(0, 10));
      const to = now.toISOString().slice(0, 10);
      const targetBranches = branchFilter ? branches.filter((branch) => branch.id === branchFilter) : branches;
      const statements = canViewFinancial
        ? await Promise.all(targetBranches.map((branch) => reporting.getIncomeStatement({ p_branch_id: branch.id, p_from_date: from, p_to_date: to })))
        : [];
      const validStatements = statements.filter((result) => !result.error && result.data);
      const expenses = canViewFinancial && targetBranches.length && validStatements.length === targetBranches.length ? validStatements.reduce((sum, result) => sum + Number(result.data?.expenses || 0), 0) : null;
      const profit = canViewFinancial && targetBranches.length && validStatements.length === targetBranches.length ? validStatements.reduce((sum, result) => sum + Number(result.data?.net_income || 0), 0) : null;
      setQuickStats({ expenses, profit, lowStockCount });
    })();
  }, [branchFilter, branches, settings?.low_stock_threshold, history.unlimited, history.minDate, canViewInventory, canViewFinancial]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const effectiveRange: Range = history.unlimited ? range : (range === 'today' ? 'today' : 'week');
      const window = periodWindow(effectiveRange);
      const fromIso = window.start.toISOString();
      const fromDate = fromIso.slice(0, 10);

      const orderPromise = canViewPos
        ? (() => {
            let q = supabase
              .from('orders')
              .select('id,status,order_type,table_id,branch_id,total,order_items(quantity)')
              .in('status', ['open', 'held'])
              .limit(5000);
            if (branchFilter) q = q.eq('branch_id', branchFilter);
            return q;
          })()
        : Promise.resolve({ data: [], error: null });

      const purchasePromise = canViewPurchases
        ? (() => {
            let q = supabase.from('purchases').select('total,returned_amount,branch_id,created_at').gte('created_at', fromIso);
            if (branchFilter) q = q.eq('branch_id', branchFilter);
            return q;
          })()
        : Promise.resolve({ data: [], error: null });

      const expensePromise = canViewExpenses
        ? (() => {
            let q = supabase.from('expenses').select('amount,branch_id,expense_date,status').gte('expense_date', fromDate).neq('status', 'voided');
            if (branchFilter) q = q.eq('branch_id', branchFilter);
            return q;
          })()
        : Promise.resolve({ data: [], error: null });

      const [ordersRes, purchasesRes, expensesRes] = await Promise.all([
        orderPromise, purchasePromise, expensePromise,
      ]);
      if (cancelled) return;

      const activeOrders = ((ordersRes.data || []) as unknown as ActiveOrderRow[]).filter((order) =>
        (order.order_items || []).some((item) => Number(item.quantity || 0) > 0),
      );
      setOps({
        openOrderValue: activeOrders.reduce((sum, order) => sum + Math.max(0, Number(order.total || 0)), 0),
        purchases: (purchasesRes.data || []).reduce((sum: number, row: Record<string, unknown>) => sum + Math.max(0, Number(row.total || 0) - Number(row.returned_amount || 0)), 0),
        expenses: (expensesRes.data || []).reduce((sum: number, row: Record<string, unknown>) => sum + Number(row.amount || 0), 0),
      });
    })();

    return () => { cancelled = true; };
  }, [
    branchFilter, range, history.unlimited,
    canViewPos, canViewPurchases, canViewExpenses,
  ]);

  const current = useMemo(() => {
    const methods = aggregatePaymentMethods(sales, salePayments);
    return {
      orders: sales.length,
      sales: sales.reduce((sum, sale) => sum + netSaleAmount(sale), 0),
      payments: methods.reduce((sum, row) => sum + row.total, 0),
      returns: sales.reduce((sum, sale) => sum + Number(sale.refunded_amount || 0), 0),
      discounts: sales.reduce((sum, sale) => sum + Number(sale.discount_amount || 0), 0),
    };
  }, [sales, salePayments]);
  const previous = useMemo(() => {
    const methods = aggregatePaymentMethods(previousSales, previousSalePayments);
    return {
      orders: previousSales.length,
      sales: previousSales.reduce((sum, sale) => sum + netSaleAmount(sale), 0),
      payments: methods.reduce((sum, row) => sum + row.total, 0),
      returns: previousSales.reduce((sum, sale) => sum + Number(sale.refunded_amount || 0), 0),
      discounts: previousSales.reduce((sum, sale) => sum + Number(sale.discount_amount || 0), 0),
    };
  }, [previousSales, previousSalePayments]);
  const paymentRows = useMemo(() => aggregatePaymentMethods(sales, salePayments).slice(0, 5), [sales, salePayments]);
  const orderRows = useMemo(() => {
    const map = new Map<string, number>();
    sales.forEach((sale) => map.set(sale.order_type || 'other', (map.get(sale.order_type || 'other') || 0) + 1));
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [sales]);
  const productRows = useMemo(() => {
    const map = new Map<string, number>();
    items.forEach((item) => {
      const product = relation(item.product);
      const name = product?.name || (ar ? 'غير محدد' : 'Unknown');
      map.set(name, (map.get(name) || 0) + netSaleItemQuantity(item));
    });
    return [...map.entries()].filter(([, qty]) => qty > 0).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [ar, items]);
  const branchRows = useMemo(() => {
    const map = new Map<string, { orders: number; sales: number }>();
    sales.forEach((sale) => {
      const branch = relation(sale.branch);
      const name = ar ? branch?.name || 'غير محدد' : branch?.name_en || branch?.name || 'Unknown';
      const row = map.get(name) || { orders: 0, sales: 0 };
      row.orders += 1; row.sales += netSaleAmount(sale); map.set(name, row);
    });
    return [...map.entries()].sort((a, b) => b[1].sales - a[1].sales).slice(0, 5);
  }, [ar, sales]);
  const lowStock = useMemo(() => stockAlerts.slice(0, 5), [stockAlerts]);

  const chart = useMemo<Point[]>(() => {
    const effectiveRange: Range = history.unlimited ? range : (range === 'today' ? 'today' : 'week');
    const window = periodWindow(effectiveRange);
    const currentMap = new Map<string, number>();
    const previousMap = new Map<string, number>();
    const key = (date: Date) => effectiveRange === 'today' ? String(date.getHours()) : effectiveRange === 'year' ? String(date.getMonth()) : date.toISOString().slice(0, 10);
    sales.forEach((sale) => currentMap.set(key(new Date(sale.created_at)), (currentMap.get(key(new Date(sale.created_at))) || 0) + netSaleAmount(sale)));
    previousSales.forEach((sale) => previousMap.set(key(new Date(sale.created_at)), (previousMap.get(key(new Date(sale.created_at))) || 0) + netSaleAmount(sale)));
    if (effectiveRange === 'today') return Array.from({ length: 24 }, (_, hour) => ({ label: `${String(hour).padStart(2, '0')}:00`, sales: currentMap.get(String(hour)) || 0, previous: previousMap.get(String(hour)) || 0 }));
    if (effectiveRange === 'year') return Array.from({ length: 12 }, (_, month) => ({ label: new Date(window.start.getFullYear(), month, 1).toLocaleDateString(ar ? 'ar-EG' : 'en-US', { month: 'short' }), sales: currentMap.get(String(month)) || 0, previous: previousMap.get(String(month)) || 0 }));
    const dayCount = effectiveRange === 'month' ? new Date(window.start.getFullYear(), window.start.getMonth() + 1, 0).getDate() : 7;
    return Array.from({ length: dayCount }, (_, index) => {
      const date = new Date(window.start); date.setDate(date.getDate() + index);
      const dateKey = date.toISOString().slice(0, 10);
      const prevDate = new Date(window.previousStart); prevDate.setDate(prevDate.getDate() + index);
      return { label: date.toLocaleDateString(ar ? 'ar-EG' : 'en-US', { day: 'numeric', month: 'short' }), sales: currentMap.get(dateKey) || 0, previous: previousMap.get(prevDate.toISOString().slice(0, 10)) || 0 };
    });
  }, [ar, previousSales, range, sales, history.unlimited]);

  const quick = (value: number | null, formatter: (value: number) => string) => value === null ? '—' : formatter(value);
  const recent = sales.slice(0, 5);

  return <div dir={ar ? 'rtl' : 'ltr'} className="min-h-[calc(100vh-64px)] w-full min-w-0 bg-ui-page py-3 sm:py-4" data-testid="dashboard-surface"><div className="w-full min-w-0 space-y-5">
    <DashboardStandbyBar canCreateSale={canCreateSale} />

    <section className="rounded-[32px] bg-gradient-to-br from-[#24114f] via-[#4b20a9] to-[#6d35df] p-6 text-white shadow-ui-lg"><div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between"><div><div className="flex items-center gap-2 text-white/80"><BarChart3 className="h-4 w-4" /><span className="text-xs font-bold uppercase tracking-[0.18em]">Premier Control</span></div><h2 className="mt-2 text-3xl font-black">{ar ? 'لوحة التحكم' : 'Dashboard'}</h2><p className="mt-1 text-sm text-white/70">{history.unlimited ? (ar ? 'الفترة الافتراضية: الشهر الحالي' : 'Default period: current month') : (ar ? 'الحد الأقصى للعرض: آخر 7 أيام' : 'Maximum visible history: last 7 days')}</p></div><div className="flex flex-wrap gap-2">{(Object.keys(rangeLabels) as Range[]).filter((item) => history.unlimited || item === 'today' || item === 'week').map((item) => <button key={item} onClick={() => setRange(item)} className={`rounded-xl px-4 py-2 text-sm font-bold ${range === item ? 'bg-white text-ui-primary' : 'bg-white/10 text-white'}`}>{rangeLabels[item][ar ? 0 : 1]}</button>)}<button onClick={() => void load()} className="rounded-xl bg-white/10 p-2" aria-label={ar ? 'تحديث' : 'Refresh'}><RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /></button></div></div></section>

    {error && <div className="rounded-2xl border border-ui-danger/30 bg-ui-danger-soft p-4 text-sm font-bold text-ui-danger">{error}</div>}

    {(canViewSales || canViewFinancial || canViewInventory) && <Card><div className="mb-4"><h2 className="text-lg font-black text-ui-text">{history.unlimited ? (ar ? 'ملخص الشهر الحالي' : 'Current month summary') : (ar ? 'ملخص آخر 7 أيام' : 'Last 7 days summary')}</h2><p className="text-xs text-ui-subtle">{ar ? 'المبيعات صافية بعد المرتجعات، والربح من قائمة الدخل المحاسبية' : 'Sales are net of refunds; profit comes from the accounting income statement'}</p></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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

      {canViewReports && canViewSales && <section className="grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.8fr)]"><Card><h2 className="text-lg font-black text-ui-text">{ar ? 'حركة صافي المبيعات' : 'Net sales performance'}</h2><div className="mt-4 h-72">{sales.length ? <Suspense fallback={<div className="flex h-full items-center justify-center"><RefreshCw className="h-5 w-5 animate-spin text-ui-primary" /></div>}><DashboardSalesChart data={chart} formatValue={money} /></Suspense> : <Empty ar={ar} />}</div></Card>
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
