import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, TrendingUp, ShoppingCart, Receipt, Package, BarChart3, CreditCard, Users, FileText, List, Layers, TrendingDown, AlertTriangle, FileDown, Printer, UserCheck, RotateCcw, Trash2 } from 'lucide-react';
import { supabase, costing, reporting } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { PageHeader, Card } from '@/components/PageHeader';
import { Button } from '@/components/Button';
import { formatCurrency, formatDate, todayISO } from '@/lib/format';
import { reportDateRangeUtc } from '@/lib/businessTime';
import { exportToExcelAdvanced } from '@/lib/excel';
import { downloadCSV, openPrintWindow } from '@/lib/reportExport';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useCan } from '@/lib/permissions';
import { useColumnPreferences } from '../useColumnPreferences';
import { ColumnPicker } from '../ColumnPicker';
import { useCustomReports } from '../useCustomReports';
import type { SavedReportConfig } from '../useCustomReports';
import { CustomReportBar } from '../CustomReportBar';
import { ReportFilterBar } from '../ReportFilterBar';
import { useBranches } from '@/hooks/useBranches';
import { useSettings } from '@/context/SettingsContext';
import {
  applySalesFilters,
  applySaleItemFilters,
  applyPurchaseFilters,
  applyExpenseFilters,
  applyProductScopedFilters,
  REPORT_FILTER_DIMS,
  DATE_DRIVEN_REPORTS,
  ORDER_TYPE_OPTIONS,
  PAYMENT_METHOD_OPTIONS,
  SALE_STATUS_OPTIONS,
  type ReportFilters,
  type ReportFilterKey,
  type ReportType,
  type EqBuilder,
} from '../reportFilters';
import {
  aggregatePaymentMethods,
  netPurchaseAmount,
  netSaleAmount,
  netSaleItemQuantity,
  netSaleItemRevenue,
  netSalePayment,
  type SalePaymentFallbackLike,
  type SalePaymentLike,
} from '../numericIntegrity';

type FinancialReportType = 'trial_balance' | 'ledger' | 'income' | 'balance_sheet' | 'ar_aging' | 'ap_aging' | 'aging_summary' | 'cash_flow' | 'party_statement';
type PeriodKey = 'custom' | 'today' | 'yesterday' | 'last7' | 'last30' | 'this_month' | 'last_month' | 'this_year';

interface ReportsPageProps {
  controlledReportType?: ReportType;
  onReportTypeChange?: (type: ReportType) => void;
}

export function ReportsPage({ controlledReportType, onReportTypeChange }: ReportsPageProps = {}) {
  /* REPORT-BRANCH-AUDIT-2026 */
  const { t, lang } = useLanguage();
  const can = useCan();
  const navigate = useNavigate();
  const branchFilter = useBranchFilter();
  const [reportType, setReportType] = useState<ReportType>('sales');
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(todayISO());
  const [period, setPeriod] = useState<PeriodKey>('custom');
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [, setChartData] = useState<{ name: string; value: number }[]>([]);
  const [summary, setSummary] = useState({ total: 0, count: 0 });
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<ReportFilters>({});
  const [options, setOptions] = useState<{
    warehouses: { id: string; name: string }[];
    cashiers: { id: string; full_name: string | null; email: string | null }[];
    customers: { id: string; name: string; name_en: string | null }[];
    suppliers: { id: string; name: string; name_en: string | null }[];
    products: { id: string; name: string; name_en: string | null }[];
    categories: { id: string; name: string; name_en: string | null }[];
    tables: { id: string; name: string }[];
    expenseCategories: string[];
  }>({ warehouses: [], cashiers: [], customers: [], suppliers: [], products: [], categories: [], tables: [], expenseCategories: [] });

  useEffect(() => {
    if (controlledReportType) {
      setReportType((prev) => {
        if (prev !== controlledReportType) {
          setFilters({});
          onReportTypeChange?.(controlledReportType);
          return controlledReportType;
        }
        return prev;
      });
    }
  }, [controlledReportType, onReportTypeChange]);

  const effectiveBranchFilter = branchFilter;
  const { branches } = useBranches();
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
  const { effectiveSettings } = useSettings();
  const currency = effectiveSettings(effectiveBranchFilter)?.currency || 'EGP';
  const { visibleColumns, toggleColumn, showAllColumns } = useColumnPreferences(reportType);
  const { savedReports, saveReport, deleteReport } = useCustomReports();
  const reportBranchLabel = effectiveBranchFilter
    ? branchNameById(effectiveBranchFilter)
    : (lang === 'ar' ? 'كل الفروع المتاحة' : 'All accessible branches');

  const filterQ = <T,>(q: T, f: ReportFilters, applier: (b: EqBuilder, x: ReportFilters) => EqBuilder): T =>
    applier(q as unknown as EqBuilder, f) as unknown as T;

  const financialTypes: { key: FinancialReportType; label: string }[] = [
    { key: 'trial_balance', label: t('trialBalance') },
    { key: 'ledger', label: t('generalLedger') },
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
      navigate(`/financial-reports?view=${value}&from=${from}&to=${to}`);
      return;
    }
    setFilters({});
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
    setPeriod(key);
    setFrom(f);
    setTo(targetTo);
  }

  useEffect(() => {
    if (!effectiveBranchFilter) {
      setOptions({ warehouses: [], cashiers: [], customers: [], suppliers: [], products: [], categories: [], tables: [], expenseCategories: [] });
      return;
    }
    (async () => {
      const [warehouses, cashiers, customers, suppliers, products, categories, tables] = await Promise.all([
        supabase.from('warehouses').select('id, name').eq('branch_id', effectiveBranchFilter),
        supabase.from('users').select('id, full_name, email').eq('branch_id', effectiveBranchFilter),
        supabase.from('customers').select('id, name, name_en').eq('branch_id', effectiveBranchFilter),
        supabase.from('suppliers').select('id, name, name_en').eq('branch_id', effectiveBranchFilter),
        supabase.from('products').select('id, name, name_en').eq('branch_id', effectiveBranchFilter),
        supabase.from('categories').select('id, name, name_en').eq('branch_id', effectiveBranchFilter),
        supabase.from('dining_tables').select('id, name').eq('branch_id', effectiveBranchFilter),
      ]);
      setOptions({
        warehouses: warehouses.data || [], cashiers: cashiers.data || [], customers: customers.data || [],
        suppliers: suppliers.data || [], products: products.data || [], categories: categories.data || [],
        tables: tables.data || [], expenseCategories: [],
      });
    })();
  }, [effectiveBranchFilter]);

  useEffect(() => {
    if (reportType !== 'expenses' || !effectiveBranchFilter) return;
    (async () => {
      const { data: categories } = await supabase.from('expenses').select('category').eq('branch_id', effectiveBranchFilter);
      const unique = Array.from(new Set((categories || []).map((r) => String((r as Record<string, unknown>).category || '')).filter(Boolean)));
      setOptions((prev) => ({ ...prev, expenseCategories: unique }));
    })();
  }, [reportType, effectiveBranchFilter]);

  useEffect(() => {
    void loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportType, from, to, effectiveBranchFilter, filters, branches]);

  async function loadReport() {
    setLoading(true);
    try {
      const { startIso: fromTs, endExclusiveIso: toExclusiveTs } = reportDateRangeUtc(from, to);

      if (reportType === 'sales') {
        let q = supabase.from('sales').select('id, branch_id, invoice_number, total, refunded_amount, status, created_at, customer:customers(name)').gte('created_at', fromTs).lt('created_at', toExclusiveTs).order('created_at', { ascending: false }).limit(5000);
        if (effectiveBranchFilter) q = q.eq('branch_id', effectiveBranchFilter);
        q = filterQ(q, filters, applySalesFilters);
        const { data: sales } = await q;
        const rows = (sales || []).map((sale: Record<string, unknown>) => {
          const net = netSaleAmount(sale);
          return withBranch(sale.branch_id, {
            [lang === 'ar' ? 'الفاتورة' : 'Invoice']: sale.invoice_number,
            [lang === 'ar' ? 'التاريخ' : 'Date']: formatDate(sale.created_at as string, lang),
            [lang === 'ar' ? 'العميل' : 'Customer']: (sale.customer as { name?: string })?.name || '',
            [lang === 'ar' ? 'الإجمالي الأصلي' : 'Original Total']: Number(sale.total || 0),
            [lang === 'ar' ? 'المرتجع' : 'Refunded']: Number(sale.refunded_amount || 0),
            [lang === 'ar' ? 'صافي المبيعات' : 'Net Sales']: net,
          });
        });
        setData(rows);
        setChartData((sales || []).slice(0, 10).map((sale: Record<string, unknown>) => ({ name: String(sale.invoice_number), value: netSaleAmount(sale) })));
        setSummary({ total: (sales || []).reduce((sum: number, sale: Record<string, unknown>) => sum + netSaleAmount(sale), 0), count: (sales || []).length });
      } else if (reportType === 'purchases') {
        let q = supabase.from('purchases').select('id, branch_id, invoice_number, total, returned_amount, status, created_at, supplier:suppliers(name)').gte('created_at', fromTs).lt('created_at', toExclusiveTs).order('created_at', { ascending: false }).limit(5000);
        if (effectiveBranchFilter) q = q.eq('branch_id', effectiveBranchFilter);
        q = filterQ(q, filters, applyPurchaseFilters);
        const { data: purchases } = await q;
        const rows = (purchases || []).map((purchase: Record<string, unknown>) => withBranch(purchase.branch_id, {
          [lang === 'ar' ? 'الفاتورة' : 'Invoice']: purchase.invoice_number,
          [lang === 'ar' ? 'التاريخ' : 'Date']: formatDate(purchase.created_at as string, lang),
          [lang === 'ar' ? 'المورد' : 'Supplier']: (purchase.supplier as { name?: string })?.name || '',
          [lang === 'ar' ? 'الإجمالي الأصلي' : 'Original Total']: Number(purchase.total || 0),
          [lang === 'ar' ? 'مرتجع المشتريات' : 'Returned']: Number(purchase.returned_amount || 0),
          [lang === 'ar' ? 'صافي المشتريات' : 'Net Purchases']: netPurchaseAmount(purchase),
        }));
        setData(rows);
        setChartData((purchases || []).slice(0, 10).map((purchase: Record<string, unknown>) => ({ name: String(purchase.invoice_number), value: netPurchaseAmount(purchase) })));
        setSummary({ total: (purchases || []).reduce((sum: number, purchase: Record<string, unknown>) => sum + netPurchaseAmount(purchase), 0), count: (purchases || []).length });
      } else if (reportType === 'expenses') {
        let q = supabase.from('expenses').select('id, branch_id, category, description, amount, expense_date').eq('status', 'posted').gte('expense_date', from).lte('expense_date', to).order('expense_date', { ascending: false }).limit(5000);
        if (effectiveBranchFilter) q = q.eq('branch_id', effectiveBranchFilter);
        q = filterQ(q, filters, applyExpenseFilters);
        const { data: expenses } = await q;
        const rows = (expenses || []).map((expense: Record<string, unknown>) => withBranch(expense.branch_id, {
          [lang === 'ar' ? 'التاريخ' : 'Date']: formatDate(expense.expense_date as string, lang),
          [lang === 'ar' ? 'الفئة' : 'Category']: expense.category || '',
          [lang === 'ar' ? 'الوصف' : 'Description']: expense.description || '',
          [lang === 'ar' ? 'المبلغ' : 'Amount']: Number(expense.amount || 0),
        }));
        setData(rows);
        const catMap = new Map<string, number>();
        (expenses || []).forEach((expense: Record<string, unknown>) => catMap.set(String(expense.category || ''), (catMap.get(String(expense.category || '')) || 0) + Number(expense.amount || 0)));
        setChartData(Array.from(catMap.entries()).map(([name, value]) => ({ name: name || (lang === 'ar' ? 'غير محدد' : 'Other'), value })));
        setSummary({ total: (expenses || []).reduce((sum: number, expense: Record<string, unknown>) => sum + Number(expense.amount || 0), 0), count: (expenses || []).length });
      } else if (reportType === 'profit') {
        const targetBranches = effectiveBranchFilter
          ? branches.filter((branch) => branch.id === effectiveBranchFilter)
          : branches;
        const results = await Promise.all(targetBranches.map(async (branch) => {
          const { data: statement } = await reporting.getIncomeStatement({ p_branch_id: branch.id, p_from_date: from, p_to_date: to });
          return { branch, statement };
        }));
        const rows = results.map(({ branch, statement }) => withBranch(branch.id, {
          [lang === 'ar' ? 'الفترة' : 'Period']: `${from} - ${to}`,
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
        let rawQuery = supabase
          .from('raw_material_batches')
          .select('branch_id,warehouse_id,quantity,raw_material:raw_materials(id,name,code,min_stock),warehouse:warehouses(name)');
        let unitQuery = supabase
          .from('inventory_unit_batches')
          .select('branch_id,warehouse_id,quantity,unit:inventory_units(id,name,barcode,min_stock,low_stock_threshold),warehouse:warehouses(name)');
        if (effectiveBranchFilter) {
          rawQuery = rawQuery.eq('branch_id', effectiveBranchFilter);
          unitQuery = unitQuery.eq('branch_id', effectiveBranchFilter);
        }
        if (filters.warehouse) {
          rawQuery = rawQuery.eq('warehouse_id', filters.warehouse);
          unitQuery = unitQuery.eq('warehouse_id', filters.warehouse);
        }
        const [rawResult, unitResult] = await Promise.all([rawQuery.limit(20000), unitQuery.limit(20000)]);
        const stockMap = new Map<string, { branchId: string; warehouse: string; item: string; code: string; type: string; quantity: number }>();
        (rawResult.data || []).forEach((row: Record<string, unknown>) => {
          const material = row.raw_material as { id?: string; name?: string; code?: string } | null;
          const warehouse = row.warehouse as { name?: string } | null;
          const branchId = String(row.branch_id || '');
          const warehouseId = String(row.warehouse_id || '');
          const itemId = String(material?.id || '');
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
        (unitResult.data || []).forEach((row: Record<string, unknown>) => {
          const unit = row.unit as { id?: string; name?: string; barcode?: string } | null;
          const warehouse = row.warehouse as { name?: string } | null;
          const branchId = String(row.branch_id || '');
          const warehouseId = String(row.warehouse_id || '');
          const itemId = String(unit?.id || '');
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
        const { payment_method: requestedMethod, ...saleFilters } = filters;
        let q = supabase.from('sales').select('id, branch_id, payment_method, total, paid_amount, refunded_amount, status').gte('created_at', fromTs).lt('created_at', toExclusiveTs).limit(5000);
        if (effectiveBranchFilter) q = q.eq('branch_id', effectiveBranchFilter);
        q = filterQ(q, saleFilters, applySalesFilters);
        const { data: sales } = await q;
        const saleRows = (sales || []) as SalePaymentFallbackLike[];
        const saleIds = saleRows.map((sale) => sale.id);
        const paymentResult = saleIds.length
          ? await supabase.from('sale_payments').select('sale_id, branch_id, payment_method, amount, refunded_amount').in('sale_id', saleIds).limit(10000)
          : { data: [] as SalePaymentLike[] };
        let methodRows = aggregatePaymentMethods(saleRows, (paymentResult.data || []) as SalePaymentLike[]);
        if (requestedMethod) methodRows = methodRows.filter((row) => row.method === requestedMethod);
        const methodLabels: Record<string, string> = {
          cash: t('cash'), card: t('card'), transfer: t('transfer'), credit: t('credit'),
          bank: lang === 'ar' ? 'تحويل بنكي' : 'Bank', instapay: 'InstaPay', wallet: lang === 'ar' ? 'محفظة' : 'Wallet',
          split: lang === 'ar' ? 'مختلط غير موزع' : 'Unallocated split', other: lang === 'ar' ? 'أخرى' : 'Other',
        };
        const rows = methodRows.map((row) => withBranch(row.branchId, {
          [lang === 'ar' ? 'طريقة الدفع' : 'Payment Method']: methodLabels[row.method] || row.method,
          [lang === 'ar' ? 'صافي المدفوع' : 'Net Paid']: row.total,
          [lang === 'ar' ? 'عدد الحركات' : 'Count']: row.count,
        }));
        setData(rows);
        setChartData(methodRows.map((row) => ({ name: `${branchNameById(row.branchId)} — ${methodLabels[row.method] || row.method}`, value: row.total })));
        setSummary({ total: methodRows.reduce((sum, row) => sum + row.total, 0), count: methodRows.reduce((sum, row) => sum + row.count, 0) });
      } else if (reportType === 'sales_by_employee') {
        let q = supabase.from('sales').select('branch_id, cashier_id, total, refunded_amount, users:users!fk_sales_cashier(full_name, email)').gte('created_at', fromTs).lt('created_at', toExclusiveTs).limit(5000);
        if (effectiveBranchFilter) q = q.eq('branch_id', effectiveBranchFilter);
        q = filterQ(q, filters, applySalesFilters);
        const { data: sales } = await q;
        const empMap = new Map<string, { branchId: string; name: string; total: number; count: number }>();
        (sales || []).forEach((sale: Record<string, unknown>) => {
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
        setSummary({ total: (sales || []).reduce((sum: number, sale: Record<string, unknown>) => sum + netSaleAmount(sale), 0), count: (sales || []).length });
      } else if (reportType === 'sales_by_product') {
        let itemsQuery = supabase.from('sale_items').select('sale_id, quantity, refunded_quantity, total, refunded_amount, product:products(name), sale:sales(id, created_at, branch_id, status, order_type, warehouse_id, cashier_id, customer_id, payment_method, total, refunded_amount)');
        if (effectiveBranchFilter) itemsQuery = itemsQuery.eq('sale.branch_id', effectiveBranchFilter);
        itemsQuery = filterQ(itemsQuery, filters, applySaleItemFilters);
        const { data: items } = await itemsQuery.limit(10000);
        const filtered = (items || []).filter((item: Record<string, unknown>) => {
          const sale = item.sale as { created_at: string } | null;
          return !!sale && sale.created_at >= fromTs && sale.created_at < toExclusiveTs;
        });
        const saleBaseTotals = new Map<string, number>();
        filtered.forEach((item: Record<string, unknown>) => {
          const saleId = String(item.sale_id || '');
          saleBaseTotals.set(saleId, (saleBaseTotals.get(saleId) || 0) + netSaleItemRevenue(item));
        });
        const prodMap = new Map<string, { branchId: string; name: string; quantity: number; total: number }>();
        filtered.forEach((item: Record<string, unknown>) => {
          const product = item.product as { name: string } | null;
          const sale = item.sale as { branch_id?: string; total?: number | string | null; refunded_amount?: number | string | null } | null;
          const name = product?.name || (lang === 'ar' ? 'غير معروف' : 'Unknown');
          const branchId = String(sale?.branch_id || '');
          const key = `${branchId}\u0000${name}`;
          const existing = prodMap.get(key) || { branchId, name, quantity: 0, total: 0 };
          const baseRevenue = netSaleItemRevenue(item);
          const saleBase = saleBaseTotals.get(String(item.sale_id || '')) || 0;
          const authoritativeSaleNet = netSaleAmount(sale || {});
          const allocatedRevenue = saleBase > 0 ? authoritativeSaleNet * (baseRevenue / saleBase) : 0;
          existing.quantity += netSaleItemQuantity(item);
          existing.total += allocatedRevenue;
          prodMap.set(key, existing);
        });
        const rows = Array.from(prodMap.values()).sort((a, b) => b.total - a.total).map((product) => withBranch(product.branchId, {
          [lang === 'ar' ? 'المنتج' : 'Product']: product.name,
          [lang === 'ar' ? 'صافي الكمية' : 'Net Quantity']: product.quantity,
          [lang === 'ar' ? 'صافي الإيراد' : 'Net Revenue']: product.total,
        }));
        setData(rows);
        setChartData(Array.from(prodMap.values()).sort((a, b) => b.total - a.total).slice(0, 10).map((product) => ({ name: product.name, value: product.total })));
        setSummary({ total: Array.from(prodMap.values()).reduce((sum, product) => sum + product.total, 0), count: rows.length });
      } else if (reportType === 'detailed_invoices') {
        let q = supabase.from('sales').select('id, branch_id, invoice_number, total, paid_amount, refunded_amount, payment_method, status, created_at, customer:customers(name), cashier:users!fk_sales_cashier(full_name)').gte('created_at', fromTs).lt('created_at', toExclusiveTs).order('created_at', { ascending: false }).limit(5000);
        if (effectiveBranchFilter) q = q.eq('branch_id', effectiveBranchFilter);
        q = filterQ(q, filters, applySalesFilters);
        const { data: sales } = await q;
        const rows = (sales || []).map((sale: Record<string, unknown>) => {
          const customer = sale.customer as { name?: string } | null;
          const cashier = sale.cashier as { full_name?: string } | null;
          return withBranch(sale.branch_id, {
            [lang === 'ar' ? 'رقم الفاتورة' : 'Invoice']: sale.invoice_number,
            [lang === 'ar' ? 'التاريخ' : 'Date']: formatDate(sale.created_at as string, lang),
            [lang === 'ar' ? 'العميل' : 'Customer']: customer?.name || '-',
            [lang === 'ar' ? 'أمين الصندوق' : 'Cashier']: cashier?.full_name || '-',
            [lang === 'ar' ? 'طريقة الدفع' : 'Payment']: sale.payment_method,
            [lang === 'ar' ? 'الإجمالي الأصلي' : 'Original Total']: Number(sale.total || 0),
            [lang === 'ar' ? 'المرتجع' : 'Refunded']: Number(sale.refunded_amount || 0),
            [lang === 'ar' ? 'صافي الفاتورة' : 'Net Total']: netSaleAmount(sale),
            [lang === 'ar' ? 'صافي المدفوع' : 'Net Paid']: netSalePayment(sale),
            [lang === 'ar' ? 'الحالة' : 'Status']: sale.status,
          });
        });
        setData(rows);
        setChartData([]);
        setSummary({ total: (sales || []).reduce((sum: number, sale: Record<string, unknown>) => sum + netSaleAmount(sale), 0), count: rows.length });
      } else if (reportType === 'component_consumption') {
        let q = supabase.from('stock_transactions').select('branch_id, product_id, quantity, unit_cost, created_at, product:products(name), warehouse:warehouses(name)').eq('component_flow', true).eq('transaction_type', 'sale').gte('created_at', fromTs).lt('created_at', toExclusiveTs);
        if (effectiveBranchFilter) q = q.eq('branch_id', effectiveBranchFilter);
        q = filterQ(q, filters, applyProductScopedFilters);
        const { data: tx } = await q.limit(5000);
        const map = new Map<string, { branchId: string; name: string; qty: number; cost: number; count: number }>();
        (tx || []).forEach((row: Record<string, unknown>) => {
          const product = row.product as { name?: string } | null;
          const name = product?.name || (lang === 'ar' ? 'غير معروف' : 'Unknown');
          const branchId = String(row.branch_id || '');
          const key = `${branchId}\u0000${name}`;
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
        let q = supabase.from('stock_transactions').select('branch_id, product_id, quantity, product:products(name)').eq('component_flow', true).eq('transaction_type', 'sale').gte('created_at', fromTs).lt('created_at', toExclusiveTs);
        if (effectiveBranchFilter) q = q.eq('branch_id', effectiveBranchFilter);
        q = filterQ(q, filters, applyProductScopedFilters);
        const { data: tx } = await q.limit(5000);
        const map = new Map<string, { branchId: string; name: string; qty: number }>();
        (tx || []).forEach((row: Record<string, unknown>) => {
          const product = row.product as { name?: string } | null;
          const name = product?.name || (lang === 'ar' ? 'غير معروف' : 'Unknown');
          const branchId = String(row.branch_id || '');
          const key = `${branchId}\u0000${name}`;
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
        let itemsQuery = supabase.from('sale_items').select('quantity, refunded_quantity, product:products(name), sale:sales(created_at, branch_id, order_type, warehouse_id, cashier_id, customer_id)');
        if (effectiveBranchFilter) itemsQuery = itemsQuery.eq('sale.branch_id', effectiveBranchFilter);
        itemsQuery = filterQ(itemsQuery, filters, applySaleItemFilters);
        const { data: items } = await itemsQuery.limit(10000);
        const filtered = (items || []).filter((item: Record<string, unknown>) => {
          const sale = item.sale as { created_at: string } | null;
          return !!sale && sale.created_at >= fromTs && sale.created_at < toExclusiveTs;
        });
        const prodMap = new Map<string, { branchId: string; name: string; quantity: number }>();
        filtered.forEach((item: Record<string, unknown>) => {
          const product = item.product as { name: string } | null;
          const sale = item.sale as { branch_id?: string } | null;
          const name = product?.name || (lang === 'ar' ? 'غير معروف' : 'Unknown');
          const branchId = String(sale?.branch_id || '');
          const key = `${branchId}\u0000${name}`;
          const existing = prodMap.get(key) || { branchId, name, quantity: 0 };
          existing.quantity += netSaleItemQuantity(item);
          prodMap.set(key, existing);
        });
        const rows = Array.from(prodMap.values()).sort((a, b) => b.quantity - a.quantity).map((product) => withBranch(product.branchId, {
          [lang === 'ar' ? 'المنتج' : 'Product']: product.name,
          [lang === 'ar' ? 'صافي الكمية' : 'Net Quantity']: product.quantity,
        }));
        setData(rows);
        setChartData(rows.slice(0, 10).map((row) => ({ name: String(row[lang === 'ar' ? 'المنتج' : 'Product']), value: Number(row[lang === 'ar' ? 'صافي الكمية' : 'Net Quantity']) })));
        setSummary({ total: rows.length, count: rows.length });
      } else if (reportType === 'recipe_costs') {
        const result = await costing.getOverview({ p_branch_id: effectiveBranchFilter });
        if (result.error) { setData([]); setChartData([]); setSummary({ total: 0, count: 0 }); return; }
        const catName = filters.category ? options.categories.find((category) => category.id === filters.category)?.name ?? filters.category : '';
        const productIds = (result.data || []).map((row) => row.product_id);
        const productBranchResult = productIds.length > 0
          ? await supabase.from('products').select('id, branch_id').in('id', productIds)
          : { data: [] as { id: string; branch_id: string }[] };
        const productBranches = new Map((productBranchResult.data || []).map((product) => [product.id, product.branch_id]));
        const rows = (result.data || [])
          .filter((row) => row.recipe_item_count > 0)
          .filter((row) => !filters.product || row.product_id === filters.product)
          .filter((row) => !catName || row.category_name === catName)
          .map((row) => withBranch(productBranches.get(row.product_id) || effectiveBranchFilter, {
            [lang === 'ar' ? 'المنتج' : 'Product']: row.product_name,
            [lang === 'ar' ? 'تكلفة الوصفة' : 'Recipe Cost']: Number(row.actual_cost),
            [lang === 'ar' ? 'سعر البيع' : 'Sale Price']: Number(row.sale_price),
            [lang === 'ar' ? 'الهامش' : 'Margin']: Number(row.sale_price) - Number(row.actual_cost),
          }));
        setData(rows);
        setChartData(rows.slice(0, 10).map((row) => ({ name: String(row[lang === 'ar' ? 'المنتج' : 'Product']), value: Number(row[lang === 'ar' ? 'الهامش' : 'Margin']) })));
        setSummary({ total: rows.reduce((sum, row) => sum + Number(row[lang === 'ar' ? 'تكلفة الوصفة' : 'Recipe Cost'] || 0), 0), count: rows.length });
      } else if (reportType === 'low_stock') {
        let rawMasterQuery = supabase.from('raw_materials').select('id,branch_id,name,code,min_stock,is_active').eq('is_active', true);
        let rawBalanceQuery = supabase.from('raw_material_inventory').select('raw_material_id,branch_id,quantity,min_stock');
        let unitMasterQuery = supabase.from('inventory_units').select('id,branch_id,name,barcode,min_stock,low_stock_threshold,is_active').eq('is_active', true);
        let unitBatchQuery = supabase.from('inventory_unit_batches').select('unit_id,branch_id,quantity');
        if (effectiveBranchFilter) {
          rawMasterQuery = rawMasterQuery.eq('branch_id', effectiveBranchFilter);
          rawBalanceQuery = rawBalanceQuery.eq('branch_id', effectiveBranchFilter);
          unitMasterQuery = unitMasterQuery.eq('branch_id', effectiveBranchFilter);
          unitBatchQuery = unitBatchQuery.eq('branch_id', effectiveBranchFilter);
        }
        const [rawMastersResult, rawBalancesResult, unitMastersResult, unitBatchesResult] = await Promise.all([
          rawMasterQuery.limit(10000),
          rawBalanceQuery.limit(10000),
          unitMasterQuery.limit(10000),
          unitBatchQuery.limit(20000),
        ]);
        const rawQty = new Map<string, number>();
        (rawBalancesResult.data || []).forEach((row: Record<string, unknown>) => {
          const key = `${String(row.branch_id || '')}:${String(row.raw_material_id || '')}`;
          rawQty.set(key, (rawQty.get(key) || 0) + Number(row.quantity || 0));
        });
        const unitQty = new Map<string, number>();
        (unitBatchesResult.data || []).forEach((row: Record<string, unknown>) => {
          const key = `${String(row.branch_id || '')}:${String(row.unit_id || '')}`;
          unitQty.set(key, (unitQty.get(key) || 0) + Number(row.quantity || 0));
        });
        const stockRows: Array<{ branchId: string; item: string; code: string; type: string; qty: number; threshold: number }> = [];
        (rawMastersResult.data || []).forEach((row: Record<string, unknown>) => {
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
        (unitMastersResult.data || []).forEach((row: Record<string, unknown>) => {
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
        let q = supabase.from('sales').select('branch_id, cashier_id, total, refunded_amount, payment_method, status, created_at, users:users!fk_sales_cashier(full_name, email)').gte('created_at', fromTs).lt('created_at', toExclusiveTs).limit(5000);
        if (effectiveBranchFilter) q = q.eq('branch_id', effectiveBranchFilter);
        const { data: sales } = await q;
        const empMap = new Map<string, { branchId: string; name: string; total: number; count: number; refundCount: number }>();
        (sales || []).forEach((sale: Record<string, unknown>) => {
          if (filters.cashier && sale.cashier_id !== filters.cashier) return;
          if (filters.warehouse && sale.warehouse_id !== filters.warehouse) return;
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
        let q = supabase.from('sales').select('id, branch_id, invoice_number, total, refunded_amount, status, created_at, customer:customers(name), cashier:users!fk_sales_cashier(full_name)').gte('created_at', fromTs).lt('created_at', toExclusiveTs).or('refunded_amount.gt.0,status.in.(returned,refunded,cancelled)').limit(5000);
        if (effectiveBranchFilter) q = q.eq('branch_id', effectiveBranchFilter);
        const { data: returns } = await q;
        const statusLabels: Record<string, string> = {
          returned: lang === 'ar' ? 'مرتجع' : 'Returned', refunded: t('refunded'), cancelled: t('statusCancelled'),
        };
        const rows = (returns || []).map((sale: Record<string, unknown>) => {
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
      } else if (reportType === 'production_waste') {
        let q = supabase.from('waste_entries').select('id, branch_id, created_at, quantity, unit_cost, total_cost, reason, product:products(name), warehouse:warehouses(name)').gte('created_at', fromTs).lt('created_at', toExclusiveTs);
        if (effectiveBranchFilter) q = q.eq('branch_id', effectiveBranchFilter);
        const { data: waste } = await q;
        const rows = (waste || []).map((row: Record<string, unknown>) => {
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
    } finally {
      setLoading(false);
    }
  }

  const handleExportExcel = () => {
    void exportToExcelAdvanced({
      data,
      filename: `report_${reportType}_${from}_${to}`,
      sheetName: reportType,
      title: reportTypes.find((row) => row.key === reportType)?.label ?? reportType,
      subtitle: `${reportBranchLabel} — ${from} — ${to}`,
      totalRow: summary.total ? { [lang === 'ar' ? 'الإجمالي' : 'Total']: summary.total, [lang === 'ar' ? 'العدد' : 'Count']: summary.count } : undefined,
      currencyColumns: moneyKeys,
      lang,
    });
  };
  const handleExportCSV = () => { downloadCSV(data, `report_${reportType}_${from}_${to}`); };

  const reportTypes: { key: ReportType; label: string; icon: React.ReactNode }[] = [
    { key: 'sales', label: t('salesReport'), icon: <TrendingUp className="w-4 h-4" /> },
    { key: 'sales_by_payment', label: t('salesByPayment'), icon: <CreditCard className="w-4 h-4" /> },
    { key: 'sales_by_employee', label: t('salesByEmployee'), icon: <Users className="w-4 h-4" /> },
    { key: 'sales_by_product', label: t('salesByProduct'), icon: <Package className="w-4 h-4" /> },
    { key: 'detailed_invoices', label: t('detailedInvoices'), icon: <List className="w-4 h-4" /> },
    { key: 'purchases', label: t('purchasesReport'), icon: <ShoppingCart className="w-4 h-4" /> },
    { key: 'expenses', label: t('expensesReport'), icon: <Receipt className="w-4 h-4" /> },
    { key: 'profit', label: t('profitReport'), icon: <BarChart3 className="w-4 h-4" /> },
    { key: 'inventory', label: t('inventoryReport'), icon: <Package className="w-4 h-4" /> },
    { key: 'component_consumption', label: t('componentConsumptionReport'), icon: <Layers className="w-4 h-4" /> },
    { key: 'recipe_costs', label: t('recipeCostReport'), icon: <FileText className="w-4 h-4" /> },
    { key: 'top_consumed_components', label: t('topConsumedComponentsReport'), icon: <TrendingDown className="w-4 h-4" /> },
    { key: 'top_consumed_products', label: t('topConsumedProductsReport'), icon: <Package className="w-4 h-4" /> },
    { key: 'low_stock', label: t('lowStockReport'), icon: <AlertTriangle className="w-4 h-4" /> },
    { key: 'cashier_performance', label: t('cashierPerformanceReport'), icon: <UserCheck className="w-4 h-4" /> },
    { key: 'returns', label: t('returnsReport'), icon: <RotateCcw className="w-4 h-4" /> },
    { key: 'production_waste', label: t('productionWasteReport'), icon: <Trash2 className="w-4 h-4" /> },
  ];

  const moneyKeys = [
    lang === 'ar' ? 'الإجمالي' : 'Total', lang === 'ar' ? 'المبلغ' : 'Amount',
    lang === 'ar' ? 'الإجمالي الأصلي' : 'Original Total', lang === 'ar' ? 'المرتجع' : 'Refunded',
    lang === 'ar' ? 'صافي المبيعات' : 'Net Sales', lang === 'ar' ? 'مرتجع المشتريات' : 'Returned',
    lang === 'ar' ? 'صافي المشتريات' : 'Net Purchases', lang === 'ar' ? 'صافي المدفوع' : 'Net Paid',
    lang === 'ar' ? 'صافي الإيراد' : 'Net Revenue', lang === 'ar' ? 'تكلفة البضاعة المباعة' : 'COGS',
    lang === 'ar' ? 'مجمل الربح' : 'Gross Profit', lang === 'ar' ? 'المصروفات' : 'Expenses',
    lang === 'ar' ? 'صافي الربح' : 'Net Profit', lang === 'ar' ? 'صافي الفاتورة' : 'Net Total',
    lang === 'ar' ? 'متوسط الفاتورة' : 'Avg Invoice', lang === 'ar' ? 'متوسط الفاتورة' : 'Avg Order',
    lang === 'ar' ? 'تكلفة الاستهلاك' : 'Consumption Cost', lang === 'ar' ? 'تكلفة الوصفة' : 'Recipe Cost',
    lang === 'ar' ? 'سعر البيع' : 'Sale Price', lang === 'ar' ? 'الهامش' : 'Margin',
    lang === 'ar' ? 'تكلفة الوحدة' : 'Unit Cost', lang === 'ar' ? 'التكلفة الإجمالية' : 'Total Cost',
    lang === 'ar' ? 'المبلغ المرتجع' : 'Refunded Amount',
  ];

  const showDate = DATE_DRIVEN_REPORTS.has(reportType);
  const allColumns = data.length > 0 ? Object.keys(data[0]) : [];
  const columns = visibleColumns ? allColumns.filter((column) => visibleColumns.includes(column)) : allColumns;
  const hiddenCount = visibleColumns ? allColumns.length - columns.length : 0;
  const allDefault = lang === 'ar' ? 'الكل' : 'All';
  const orderTypeLabels: Record<string, string> = { dine_in: t('dineIn'), takeaway: t('takeaway'), delivery: t('delivery'), drive_thru: t('driveThru') };
  const paymentMethodLabels: Record<string, string> = { cash: t('cash'), card: t('card'), transfer: t('transfer'), credit: t('credit') };
  const statusLabels: Record<string, string> = {
    completed: t('statusCompleted'), returned: lang === 'ar' ? 'مرتجع' : 'Returned', refunded: t('refunded'),
    cancelled: t('statusCancelled'), pending: t('statusPending'),
  };

  const filterLabel = (dim: ReportFilterKey): string => {
    const labels: Record<ReportFilterKey, string> = {
      warehouse: t('filterByWarehouse'), cashier: t('filterByCashier'), customer: t('filterByCustomer'),
      supplier: t('filterBySupplier'), buyer: t('filterByBuyer'), product: t('filterByProduct'),
      category: t('filterByCategory'), order_type: t('filterByOrderType'), payment_method: t('filterByPaymentMethod'),
      table: t('filterByTable'), status: t('filterByStatus'),
    };
    return labels[dim];
  };

  const allLabel = (dim: ReportFilterKey): string => {
    const labels: Partial<Record<ReportFilterKey, string>> = {
      warehouse: t('allWarehouses'), customer: t('allCustomers'), supplier: t('allSuppliers'), product: t('allProducts'),
      category: t('allCategories'), order_type: t('allOrderTypes'), payment_method: t('allPaymentMethods'),
      status: t('allStatuses'), table: t('allTables'),
    };
    return labels[dim] || allDefault;
  };

  const filterOptions = (dim: ReportFilterKey): { value: string; label: string }[] => {
    const name = (value: string, english: string | null) => (lang === 'ar' ? value : (english || value));
    switch (dim) {
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

  const handlePrint = () => {
    const reportLabel = reportTypes.find((row) => row.key === reportType)?.label ?? reportType;
    const headers = data.length > 0 ? Object.keys(data[0]) : [];
    const rows = data.map((row) => headers.map((header) => {
      const value = row[header];
      if (typeof value === 'number' && moneyKeys.includes(header)) return formatCurrency(value, currency, lang);
      return String(value ?? '');
    }));
    openPrintWindow({ title: reportLabel, subtitle: `${reportBranchLabel} — ${from} - ${to}`, headers, rows, lang: lang as 'ar' | 'en' });
  };

  return (
    <div>
      <PageHeader title={t('reports')} actions={
        <div className="flex flex-wrap gap-2">
          <ColumnPicker
            columns={data.length > 0 ? Object.keys(data[0]) : []}
            visibleColumns={visibleColumns}
            onToggle={toggleColumn}
            onShowAll={showAllColumns}
            lang={lang}
            hiddenCount={hiddenCount}
          />
          {can('reports.export') && <Button variant="outline" size="sm" onClick={handleExportExcel}><Download className="w-4 h-4" /> {t('exportExcel')}</Button>}
          {can('reports.export') && <Button variant="outline" size="sm" onClick={handleExportCSV}><FileDown className="w-4 h-4" /> {t('exportCsv')}</Button>}
          {can('reports.print') && <Button variant="outline" size="sm" onClick={handlePrint}><Printer className="w-4 h-4" /> {t('print')}</Button>}
        </div>
      } />

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

      <ReportFilterBar
        reportType={reportType}
        filters={filters}
        onFilterChange={(dim, value) => setFilters((prev) => ({ ...prev, [dim]: value }))}
        showDate={showDate}
        period={period}
        onPeriodChange={(key) => applyPeriod(key as PeriodKey)}
        from={from}
        to={to}
        onFromChange={(value) => { setFrom(value); setPeriod('custom'); }}
        onToChange={(value) => { setTo(value); setPeriod('custom'); }}
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
      />

      <Card className="p-4 border-ui-border bg-ui-surface shadow-ui">
        {loading ? (
          <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" /></div>
        ) : data.length === 0 ? (
          <div className="text-center py-12 text-ui-subtle text-sm">{t('noData')}</div>
        ) : (
          <div className="overflow-x-auto">
            {data.length >= 5000 && (
              <div className="text-xs text-ui-warning bg-ui-warning-soft border border-ui-warning/20 rounded-lg px-3 py-2 mb-3">
                {lang === 'ar' ? 'تم عرض أول 5,000 سجل. استخدم الفلاتر لتضييق النتائج.' : 'Showing first 5,000 records. Use filters to narrow results.'}
              </div>
            )}
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ui-border">
                  {columns.map((key) => <th key={key} className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{key}</th>)}
                </tr>
              </thead>
              <tbody>
                {data.map((row, index) => (
                  <tr key={index} className="border-b border-ui-border/60 hover:bg-ui-page-alt">
                    {columns.map((key, columnIndex) => {
                      const value = row[key];
                      return (
                        <td key={columnIndex} className="px-4 py-3 text-ui-text">
                          {typeof value === 'number' && moneyKeys.includes(key) ? formatCurrency(value, currency, lang) : String(value ?? '')}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
