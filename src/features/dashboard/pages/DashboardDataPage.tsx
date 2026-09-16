import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowDown, ArrowUp, ArrowUpRight, BarChart3, CreditCard,
  RefreshCw, RotateCcw, ShoppingBag, Tag, Wallet,
} from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { reporting, supabase } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useSettings } from '@/context/SettingsContext';
import { useBranches } from '@/hooks/useBranches';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/format';
import {
  aggregatePaymentMethods,
  netSaleAmount,
  netSaleItemQuantity,
  type SalePaymentLike,
} from '@/features/reporting/numericIntegrity';

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
type Inventory = { quantity: number | null; product?: RelatedName | RelatedName[] | null };
type SaleItem = { quantity: number | null; refunded_quantity: number | null; product?: RelatedName | RelatedName[] | null };
type Point = { label: string; sales: number; previous: number };
type QuickStats = { sales: number | null; expenses: number | null; profit: number | null; lowStockCount: number | null };

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

function relation<T extends RelatedName>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value || undefined;
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
  return <section className={`rounded-3xl border border-ui-border bg-ui-surface p-5 shadow-ui ${className}`}>{children}</section>;
}

function Empty({ ar }: { ar: boolean }) {
  return <div className="flex min-h-[120px] items-center justify-center text-sm text-ui-subtle">{ar ? 'لا توجد بيانات فعلية للفترة المحددة' : 'No actual data for the selected period'}</div>;
}

function Metric({ testId, icon: Icon, title, value, display, previous, href, ar }: {
  testId: string; icon: typeof Wallet; title: string; value: number; display: string; previous: number; href: string; ar: boolean;
}) {
  const change = previous > 0 ? ((value - previous) / previous) * 100 : null;
  const positive = (change ?? 0) >= 0;
  return <Link data-testid={testId} to={href} className="group rounded-3xl border border-ui-border bg-ui-surface p-5 shadow-ui transition hover:-translate-y-0.5 hover:shadow-ui-lg">
    <div className="flex items-start justify-between"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-ui-primary-soft text-ui-primary"><Icon className="h-5 w-5" /></div><ArrowUpRight className="h-4 w-4 text-ui-subtle" /></div>
    <p className="mt-5 text-sm font-semibold text-ui-muted">{title}</p><p className="mt-1 text-3xl font-black tracking-tight text-ui-text">{display}</p>
    <div className="mt-2 flex items-center gap-2 text-xs">{change === null ? <span className="text-ui-subtle">—</span> : <span className={`inline-flex items-center gap-0.5 font-bold ${positive ? 'text-ui-success' : 'text-ui-danger'}`}>{positive ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}{formatPercent(Math.abs(change), 1)}</span>}<span className="text-ui-subtle">{ar ? 'مقارنة بالفترة السابقة' : 'vs previous period'}</span></div>
  </Link>;
}

export function DashboardDataPage() {
  const { lang } = useLanguage();
  const { user } = useAuth();
  const branchFilter = useBranchFilter();
  const { effectiveSettings } = useSettings();
  const { branches } = useBranches();
  const ar = lang === 'ar';
  const [range, setRange] = useState<Range>('month');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [previousSales, setPreviousSales] = useState<Sale[]>([]);
  const [salePayments, setSalePayments] = useState<SalePaymentLike[]>([]);
  const [previousSalePayments, setPreviousSalePayments] = useState<SalePaymentLike[]>([]);
  const [inventory, setInventory] = useState<Inventory[]>([]);
  const [items, setItems] = useState<SaleItem[]>([]);
  const [quickStats, setQuickStats] = useState<QuickStats>({ sales: null, expenses: null, profit: null, lowStockCount: null });
  const settings = effectiveSettings(branchFilter);
  const money = useCallback((value: number) => formatCurrency(value, settings?.currency || 'EGP', lang), [settings?.currency, lang]);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    const window = periodWindow(range);
    const fields = 'id,invoice_number,total,paid_amount,payment_method,status,branch_id,created_at,order_type,refunded_amount,discount_amount,branch:branches(name,name_en)';
    let currentQuery = supabase.from('sales').select(fields).gte('created_at', window.start.toISOString()).lte('created_at', window.end.toISOString()).order('created_at', { ascending: false }).limit(5000);
    let previousQuery = supabase.from('sales').select(fields).gte('created_at', window.previousStart.toISOString()).lte('created_at', window.previousEnd.toISOString()).order('created_at', { ascending: false }).limit(5000);
    let inventoryQuery = supabase.from('inventory').select('quantity,product:products(name,low_stock_threshold)').limit(5000);
    if (branchFilter) {
      currentQuery = currentQuery.eq('branch_id', branchFilter);
      previousQuery = previousQuery.eq('branch_id', branchFilter);
      inventoryQuery = inventoryQuery.eq('branch_id', branchFilter);
    }

    const [currentResult, previousResult, inventoryResult] = await Promise.all([currentQuery, previousQuery, inventoryQuery]);
    const currentRows = currentResult.error ? [] : ((currentResult.data || []) as unknown as Sale[]);
    const previousRows = previousResult.error ? [] : ((previousResult.data || []) as unknown as Sale[]);
    setSales(currentRows);
    setPreviousSales(previousRows);
    setInventory(inventoryResult.error ? [] : ((inventoryResult.data || []) as unknown as Inventory[]));
    if (currentResult.error) setError(ar ? 'تعذر تحميل بيانات المبيعات. أعد المحاولة.' : 'Sales data could not be loaded. Please retry.');

    const ids = [...currentRows, ...previousRows].map((sale) => sale.id);
    if (ids.length) {
      const paymentResult = await supabase.from('sale_payments').select('sale_id,branch_id,payment_method,amount,refunded_amount').in('sale_id', ids).limit(20000);
      const details = paymentResult.error ? [] : ((paymentResult.data || []) as SalePaymentLike[]);
      const currentIds = new Set(currentRows.map((sale) => sale.id));
      const previousIds = new Set(previousRows.map((sale) => sale.id));
      setSalePayments(details.filter((payment) => currentIds.has(payment.sale_id)));
      setPreviousSalePayments(details.filter((payment) => previousIds.has(payment.sale_id)));
    } else {
      setSalePayments([]); setPreviousSalePayments([]);
    }

    if (currentRows.length) {
      const itemResult = await supabase.from('sale_items').select('quantity,refunded_quantity,product:products(name)').in('sale_id', currentRows.map((sale) => sale.id)).limit(20000);
      setItems(itemResult.error ? [] : ((itemResult.data || []) as unknown as SaleItem[]));
    } else setItems([]);

    setLoading(false);
    setRefreshing(false);
  }, [ar, branchFilter, range]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    void (async () => {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      let salesQuery = supabase.from('sales').select('total,refunded_amount').gte('created_at', monthStart.toISOString()).lt('created_at', monthEnd.toISOString());
      let inventoryQuery = supabase.from('inventory').select('quantity,product:products(low_stock_threshold)');
      if (branchFilter) { salesQuery = salesQuery.eq('branch_id', branchFilter); inventoryQuery = inventoryQuery.eq('branch_id', branchFilter); }
      const [salesResult, inventoryResult] = await Promise.all([salesQuery, inventoryQuery]);
      const salesValue = salesResult.error ? null : (salesResult.data || []).reduce((sum: number, row: Record<string, unknown>) => sum + netSaleAmount(row), 0);
      const lowStockCount = inventoryResult.error ? null : (inventoryResult.data || []).filter((row: Record<string, unknown>) => {
        const product = relation(row.product as RelatedName | RelatedName[] | null);
        return Number(row.quantity || 0) <= Number(product?.low_stock_threshold ?? settings?.low_stock_threshold ?? 5);
      }).length;
      const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
      const targetBranches = branchFilter ? branches.filter((branch) => branch.id === branchFilter) : branches;
      const statements = await Promise.all(targetBranches.map((branch) => reporting.getIncomeStatement({ p_branch_id: branch.id, p_from_date: from, p_to_date: to })));
      const validStatements = statements.filter((result) => !result.error && result.data);
      const expenses = targetBranches.length && validStatements.length === targetBranches.length ? validStatements.reduce((sum, result) => sum + Number(result.data?.expenses || 0), 0) : null;
      const profit = targetBranches.length && validStatements.length === targetBranches.length ? validStatements.reduce((sum, result) => sum + Number(result.data?.net_income || 0), 0) : null;
      setQuickStats({ sales: salesValue, expenses, profit, lowStockCount });
    })();
  }, [branchFilter, branches, settings?.low_stock_threshold]);

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
  const lowStock = useMemo(() => inventory.filter((row) => {
    const product = relation(row.product);
    return Number(row.quantity || 0) <= Number(product?.low_stock_threshold ?? settings?.low_stock_threshold ?? 5);
  }).slice(0, 5), [inventory, settings?.low_stock_threshold]);

  const chart = useMemo<Point[]>(() => {
    const window = periodWindow(range);
    const currentMap = new Map<string, number>();
    const previousMap = new Map<string, number>();
    const key = (date: Date) => range === 'today' ? String(date.getHours()) : range === 'year' ? String(date.getMonth()) : date.toISOString().slice(0, 10);
    sales.forEach((sale) => currentMap.set(key(new Date(sale.created_at)), (currentMap.get(key(new Date(sale.created_at))) || 0) + netSaleAmount(sale)));
    previousSales.forEach((sale) => previousMap.set(key(new Date(sale.created_at)), (previousMap.get(key(new Date(sale.created_at))) || 0) + netSaleAmount(sale)));
    if (range === 'today') return Array.from({ length: 24 }, (_, hour) => ({ label: `${String(hour).padStart(2, '0')}:00`, sales: currentMap.get(String(hour)) || 0, previous: previousMap.get(String(hour)) || 0 }));
    if (range === 'year') return Array.from({ length: 12 }, (_, month) => ({ label: new Date(window.start.getFullYear(), month, 1).toLocaleDateString(ar ? 'ar-EG' : 'en-US', { month: 'short' }), sales: currentMap.get(String(month)) || 0, previous: previousMap.get(String(month)) || 0 }));
    const dayCount = range === 'month' ? new Date(window.start.getFullYear(), window.start.getMonth() + 1, 0).getDate() : 7;
    return Array.from({ length: dayCount }, (_, index) => {
      const date = new Date(window.start); date.setDate(date.getDate() + index);
      const dateKey = date.toISOString().slice(0, 10);
      const prevDate = new Date(window.previousStart); prevDate.setDate(prevDate.getDate() + index);
      return { label: date.toLocaleDateString(ar ? 'ar-EG' : 'en-US', { day: 'numeric', month: 'short' }), sales: currentMap.get(dateKey) || 0, previous: previousMap.get(prevDate.toISOString().slice(0, 10)) || 0 };
    });
  }, [ar, previousSales, range, sales]);

  const quick = (value: number | null, formatter: (value: number) => string) => value === null ? '—' : formatter(value);
  const recent = sales.slice(0, 5);

  return <div dir={ar ? 'rtl' : 'ltr'} className="min-h-[calc(100vh-64px)] bg-ui-page px-4 py-5 sm:px-7 sm:py-7" data-testid="dashboard-surface"><div className="mx-auto max-w-[1560px] space-y-6">
    <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><h1 className="text-2xl font-black text-ui-text">{ar ? `مرحباً، ${user?.full_name || 'مدير النظام'}` : `Welcome back, ${user?.full_name || 'Admin'}`}</h1><p className="mt-1 text-sm text-ui-muted">{ar ? 'بيانات فعلية من النظام حسب الفترة والفرع المحددين' : 'Live system data for the selected period and branch'}</p></div><Link to="/pos" className="inline-flex items-center gap-2 rounded-xl bg-ui-primary px-4 py-2 text-sm font-bold text-ui-primary-fg"><ShoppingBag className="h-4 w-4" />{ar ? 'إنشاء بيع' : 'New sale'}</Link></section>

    <section className="rounded-[32px] bg-gradient-to-br from-[#24114f] via-[#4b20a9] to-[#6d35df] p-6 text-white shadow-ui-lg"><div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between"><div><div className="flex items-center gap-2 text-white/80"><BarChart3 className="h-4 w-4" /><span className="text-xs font-bold uppercase tracking-[0.18em]">Premier Control</span></div><h2 className="mt-2 text-3xl font-black">{ar ? 'لوحة التحكم' : 'Dashboard'}</h2><p className="mt-1 text-sm text-white/70">{ar ? 'الفترة الافتراضية: الشهر الحالي' : 'Default period: current month'}</p></div><div className="flex flex-wrap gap-2">{(Object.keys(rangeLabels) as Range[]).map((item) => <button key={item} onClick={() => setRange(item)} className={`rounded-xl px-4 py-2 text-sm font-bold ${range === item ? 'bg-white text-ui-primary' : 'bg-white/10 text-white'}`}>{rangeLabels[item][ar ? 0 : 1]}</button>)}<button onClick={() => void load()} className="rounded-xl bg-white/10 p-2" aria-label={ar ? 'تحديث' : 'Refresh'}><RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /></button></div></div></section>

    {error && <div className="rounded-2xl border border-ui-danger/30 bg-ui-danger-soft p-4 text-sm font-bold text-ui-danger">{error}</div>}

    <Card><div className="mb-4"><h2 className="text-lg font-black text-ui-text">{ar ? 'ملخص الشهر الحالي' : 'Current month summary'}</h2><p className="text-xs text-ui-subtle">{ar ? 'المبيعات صافية بعد المرتجعات، والربح من قائمة الدخل المحاسبية' : 'Sales are net of refunds; profit comes from the accounting income statement'}</p></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <div className="rounded-2xl bg-ui-page-alt p-4"><p className="text-xs text-ui-subtle">{ar ? 'صافي مبيعات الشهر' : 'Net sales this month'}</p><p className="mt-2 text-xl font-black text-ui-text">{quick(quickStats.sales, money)}</p></div>
      <div className="rounded-2xl bg-ui-page-alt p-4"><p className="text-xs text-ui-subtle">{ar ? 'المصروفات المحاسبية' : 'Accounting expenses'}</p><p className="mt-2 text-xl font-black text-ui-text">{quick(quickStats.expenses, money)}</p></div>
      <div className="rounded-2xl bg-ui-page-alt p-4"><p className="text-xs text-ui-subtle">{ar ? 'صافي الربح المحاسبي' : 'Accounting net profit'}</p><p className="mt-2 text-xl font-black text-ui-text">{quick(quickStats.profit, money)}</p></div>
      <div className="rounded-2xl bg-ui-page-alt p-4"><p className="text-xs text-ui-subtle">{ar ? 'تنبيهات المخزون' : 'Low stock alerts'}</p><p className="mt-2 text-xl font-black text-ui-text">{quick(quickStats.lowStockCount, (value) => formatNumber(value, 0))}</p></div>
    </div></Card>

    {loading ? <div className="flex h-64 items-center justify-center rounded-3xl border border-ui-border bg-ui-surface"><RefreshCw className="h-7 w-7 animate-spin text-ui-primary" /></div> : <>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Metric testId="kpi-orders" icon={ShoppingBag} title={ar ? 'الطلبات' : 'Orders'} value={current.orders} display={formatNumber(current.orders, 0)} previous={previous.orders} href="/reports?reportType=detailed_invoices" ar={ar} />
        <Metric testId="kpi-net-sales" icon={Wallet} title={ar ? 'صافي المبيعات' : 'Net sales'} value={current.sales} display={money(current.sales)} previous={previous.sales} href="/reports?reportType=sales" ar={ar} />
        <Metric testId="kpi-net-payments" icon={CreditCard} title={ar ? 'صافي المدفوعات' : 'Net payments'} value={current.payments} display={money(current.payments)} previous={previous.payments} href="/reports?reportType=sales_by_payment" ar={ar} />
        <Metric testId="kpi-returns" icon={RotateCcw} title={ar ? 'المبالغ المرتجعة' : 'Return amount'} value={current.returns} display={money(current.returns)} previous={previous.returns} href="/reports?reportType=returns" ar={ar} />
        <Metric testId="kpi-discounts" icon={Tag} title={ar ? 'إجمالي الخصومات' : 'Discount amount'} value={current.discounts} display={money(current.discounts)} previous={previous.discounts} href="/reports?reportType=sales" ar={ar} />
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.8fr)]"><Card><h2 className="text-lg font-black text-ui-text">{ar ? 'حركة صافي المبيعات' : 'Net sales performance'}</h2><div className="mt-4 h-72">{sales.length ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={chart}><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip formatter={(value) => money(Number(value || 0))} /><Area type="monotone" dataKey="sales" stroke="currentColor" fill="currentColor" fillOpacity={0.12} /></AreaChart></ResponsiveContainer> : <Empty ar={ar} />}</div></Card>
      <div className="grid gap-5"><Card><h2 className="font-black text-ui-text">{ar ? 'أنواع الطلبات' : 'Order types'}</h2><div className="mt-3 space-y-3">{orderRows.length ? orderRows.map(([key, count]) => <div key={key} className="flex justify-between text-sm"><span className="text-ui-muted">{orderLabels[key]?.[ar ? 0 : 1] || key}</span><b className="text-ui-text">{formatNumber(count, 0)}</b></div>) : <Empty ar={ar} />}</div></Card>
      <Card><h2 className="font-black text-ui-text">{ar ? 'طرق الدفع' : 'Payment methods'}</h2><div className="mt-3 space-y-3">{paymentRows.length ? paymentRows.map((row) => <div key={`${row.branchId}-${row.method}`} className="flex justify-between gap-3 text-sm"><span className="text-ui-muted">{paymentLabels[row.method]?.[ar ? 0 : 1] || row.method}</span><b className="text-ui-text">{money(row.total)}</b></div>) : <Empty ar={ar} />}</div></Card></div></section>

      <section className="grid gap-5 xl:grid-cols-3"><Card><h2 className="mb-3 font-black text-ui-text">{ar ? 'الفروع حسب صافي المبيعات' : 'Branches by net sales'}</h2>{branchRows.length ? branchRows.map(([name, row]) => <div key={name} className="mb-3 flex justify-between gap-3 text-sm"><span className="font-semibold text-ui-text">{name}</span><span className="text-ui-muted">{formatNumber(row.orders, 0)} · {money(row.sales)}</span></div>) : <Empty ar={ar} />}</Card>
      <Card><h2 className="mb-3 font-black text-ui-text">{ar ? 'أكثر الأصناف مبيعًا' : 'Top selling items'}</h2>{productRows.length ? productRows.map(([name, qty]) => <div key={name} className="mb-3 flex justify-between gap-3 text-sm"><span className="font-semibold text-ui-text">{name}</span><span className="text-ui-muted">{formatNumber(qty, 2)}</span></div>) : <Empty ar={ar} />}</Card>
      <Card><h2 className="mb-3 font-black text-ui-text">{ar ? 'أحدث الطلبات' : 'Recent orders'}</h2>{recent.length ? recent.map((sale) => <div key={sale.id} className="mb-3 flex justify-between gap-3 text-sm"><span className="font-semibold text-ui-text">{sale.invoice_number || '—'}</span><span className="text-ui-muted">{money(netSaleAmount(sale))}</span></div>) : <Empty ar={ar} />}</Card></section>

      {lowStock.length > 0 && <Card className="border-ui-warning/30"><div className="mb-3 flex items-center gap-2 font-black text-ui-warning"><AlertTriangle className="h-5 w-5" />{ar ? 'تنبيه المخزون المنخفض' : 'Low stock alert'}</div><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">{lowStock.map((row, index) => { const product = relation(row.product); return <Link key={index} to="/inventory" className="rounded-xl bg-ui-page-alt p-3"><p className="truncate text-sm font-bold text-ui-text">{product?.name || '—'}</p><p className="mt-1 text-xs text-ui-warning">{formatNumber(Number(row.quantity || 0), 2)}</p></Link>; })}</div></Card>}
    </>}
  </div></div>;
}
