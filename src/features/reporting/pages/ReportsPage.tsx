import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, TrendingUp, ShoppingCart, Receipt, Package, BarChart3, CreditCard, Users, FileText, List, Layers, TrendingDown, AlertTriangle, FileDown, Printer, UserCheck, RotateCcw, Trash2 } from 'lucide-react';
import { supabase, costing, reporting } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { Card } from '@/components/PageHeader';
import { Button } from '@/components/Button';
import { formatFinancialCurrency, formatDate, todayISO } from '@/lib/format';
import { reportDateRangeUtc } from '@/lib/businessTime';
import { exportToExcelAdvanced } from '@/lib/excel';
import { downloadCSV, openPrintWindow } from '@/lib/reportExport';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useCan } from '@/lib/permissions';
import { useHistoryAccess } from '@/lib/useHistoryAccess';
import { useColumnPreferences } from '../useColumnPreferences';
import { ColumnPicker } from '../ColumnPicker';
import { getReportExcelProfile } from '../reportExcelProfiles';
import { fetchAllReportRows, type RangePageQuery } from '../fetchAllReportRows';
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
  allocateSaleNetRevenue,
  netPurchaseAmount,
  netSaleAmount,
  netSaleItemQuantity,
  netSaleItemRevenue,
  netSalePayment,
} from '../numericIntegrity';

type FinancialReportType = 'trial_balance' | 'ledger' | 'treasury_statement' | 'inventory_movement' | 'income' | 'balance_sheet' | 'ar_aging' | 'ap_aging' | 'aging_summary' | 'cash_flow' | 'party_statement';
type PeriodKey = 'custom' | 'today' | 'yesterday' | 'last7' | 'last30' | 'this_month' | 'last_month' | 'this_year';

interface ReportsPageProps {
  controlledReportType?: ReportType;
  onReportTypeChange?: (type: ReportType) => void;
}

export function ReportsPage({ controlledReportType, onReportTypeChange }: ReportsPageProps = {}) {
  /* REPORT-BRANCH-AUDIT-2026 */
  const { t, lang } = useLanguage();
  const can = useCan();
  const history = useHistoryAccess();
  const navigate = useNavigate();
  const branchFilter = useBranchFilter();
  const [reportType, setReportType] = useState<ReportType>('sales');
  const [from, setFrom] = useState(() => history.minDate || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(todayISO());
  const [period, setPeriod] = useState<PeriodKey>('custom');
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [, setChartData] = useState<{ name: string; value: number }[]>([]);
  const [summary, setSummary] = useState({ total: 0, count: 0 });
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<ReportFilters>({});
  const [filtersDirty, setFiltersDirty] = useState(false);
  const [queryVersion, setQueryVersion] = useState(0);
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
          setFiltersDirty(false);
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
  const reportBranchLabel = effectiveBranchFilter
    ? branchNameById(effectiveBranchFilter)
    : (lang === 'ar' ? 'كل الفروع المتاحة' : 'All accessible branches');

  const filterQ = <T,>(q: T, f: ReportFilters, applier: (b: EqBuilder, x: ReportFilters) => EqBuilder): T =>
    applier(q as unknown as EqBuilder, f) as unknown as T;
  const fetchRows = <T,>(query: unknown): Promise<T[]> => fetchAllReportRows(query as RangePageQuery<T>);

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
      navigate(`/financial-reports?view=${value}&from=${allowed.from}&to=${allowed.to}`);
      return;
    }
    setFilters({});
    setFiltersDirty(false);
    setReportType(value as ReportType);
    onReportTypeChange?.(value as ReportType);
  }

  const runReport = () => {
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
    // Date/filter edits are intentionally applied only when the user presses
    // "Run report". This avoids repeated report queries while configuring filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportType, effectiveBranchFilter, branches, history.unlimited, queryVersion]);

  async function loadReport() {
    setLoading(true);
    try {
      const allowed = history.clampRange(from, to);
      if (allowed.from !== from) setFrom(allowed.from);
      if (allowed.to !== to) setTo(allowed.to);
      const { startIso: fromTs, endExclusiveIso: toExclusiveTs } = reportDateRangeUtc(allowed.from, allowed.to);

      if (reportType === 'sales') {
        let q = supabase.from('sales').select('id, branch_id, invoice_number, total, refunded_amount, status, created_at, customer:customers(name)').gte('created_at', fromTs).lt('created_at', toExclusiveTs).order('created_at', { ascending: false });
        if (effectiveBranchFilter) q = q.eq('branch_id', effectiveBranchFilter);
        q = filterQ(q, filters, applySalesFilters);
        const sales = await fetchRows<Record<string, unknown>>(q);
        const rows = sales.map((sale: Record<string, unknown>) => {
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
        setChartData(sales.slice(0, 10).map((sale: Record<string, unknown>) => ({ name: String(sale.invoice_number), value: netSaleAmount(sale) })));
        setSummary({ total: sales.reduce((sum: number, sale: Record<string, unknown>) => sum + netSaleAmount(sale), 0), count: sales.length });
      } else if (reportType === 'purchases') {
        let q = supabase.from('purchases').select('id, branch_id, invoice_number, total, returned_amount, status, created_at, supplier:suppliers(name)').gte('created_at', fromTs).lt('created_at', toExclusiveTs).order('created_at', { ascending: false });
        if (effectiveBranchFilter) q = q.eq('branch_id', effectiveBranchFilter);
        q = filterQ(q, filters, applyPurchaseFilters);
        const purchases = await fetchRows<Record<string, unknown>>(q);
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
        let q = supabase.from('expenses').select('id, branch_id, category, description, amount, expense_date').eq('status', 'posted').gte('expense_date', from).lte('expense_date', to).order('expense_date', { ascending: false });
        if (effectiveBranchFilter) q = q.eq('branch_id', effectiveBranchFilter);
        q = filterQ(q, filters, applyExpenseFilters);
        const expenses = await fetchRows<Record<string, unknown>>(q);
        const rows = expenses.map((expense: Record<string, unknown>) => withBranch(expense.branch_id, {
          [lang === 'ar' ? 'التاريخ' : 'Date']: formatDate(expense.expense_date as string, lang),
          [lang === 'ar' ? 'الفئة' : 'Category']: expense.category || '',
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
        const [rawRows, unitRows] = await Promise.all([
          fetchRows<Record<string, unknown>>(rawQuery),
          fetchRows<Record<string, unknown>>(unitQuery),
        ]);
        const stockMap = new Map<string, { branchId: string; warehouse: string; item: string; code: string; type: string; quantity: number }>();
        rawRows.forEach((row: Record<string, unknown>) => {
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
        unitRows.forEach((row: Record<string, unknown>) => {
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
          credit: t('credit'),
          employee_credit: lang === 'ar' ? 'آجل موظفين' : 'Employee Credit',
          bank_legacy: lang === 'ar' ? 'بنك تاريخي غير مصنف' : 'Legacy Bank (Unclassified)',
          other: lang === 'ar' ? 'أخرى' : 'Other',
        };
        let paymentSummaryTotal = 0;
        let paymentInvoiceCount = 0;
        const methodRows = results.flatMap((result, index) => {
          const raw = (result.data as Record<string, unknown> | null) || {};
          if (result.error || raw.success === false || !Array.isArray(raw.rows)) return [];
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
        let q = supabase.from('sales').select('branch_id, cashier_id, total, refunded_amount, users:users!fk_sales_cashier(full_name, email)').gte('created_at', fromTs).lt('created_at', toExclusiveTs);
        if (effectiveBranchFilter) q = q.eq('branch_id', effectiveBranchFilter);
        q = filterQ(q, filters, applySalesFilters);
        const sales = await fetchRows<Record<string, unknown>>(q);
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
        let itemsQuery = supabase.from('sale_items').select('sale_id, quantity, refunded_quantity, total, refunded_amount, product:products(name), sale:sales(id, created_at, branch_id, status, order_type, warehouse_id, cashier_id, customer_id, payment_method, total, refunded_amount)');
        if (effectiveBranchFilter) itemsQuery = itemsQuery.eq('sale.branch_id', effectiveBranchFilter);
        itemsQuery = filterQ(itemsQuery, filters, applySaleItemFilters);
        const items = await fetchRows<Record<string, unknown>>(itemsQuery);
        const filtered = items.filter((item: Record<string, unknown>) => {
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
          const allocatedRevenue = allocateSaleNetRevenue(baseRevenue, authoritativeSaleNet, saleBase);
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
        let q = supabase.from('sales').select('id, branch_id, invoice_number, total, paid_amount, refunded_amount, payment_method, status, created_at, customer:customers(name), cashier:users!fk_sales_cashier(full_name)').gte('created_at', fromTs).lt('created_at', toExclusiveTs).order('created_at', { ascending: false });
        if (effectiveBranchFilter) q = q.eq('branch_id', effectiveBranchFilter);
        q = filterQ(q, filters, applySalesFilters);
        const sales = await fetchRows<Record<string, unknown>>(q);
        const rows = sales.map((sale: Record<string, unknown>) => {
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
        setSummary({ total: sales.reduce((sum: number, sale: Record<string, unknown>) => sum + netSaleAmount(sale), 0), count: rows.length });
      } else if (reportType === 'component_consumption') {
        let q = supabase.from('stock_transactions').select('branch_id, product_id, quantity, unit_cost, created_at, product:products(name), warehouse:warehouses(name)').eq('component_flow', true).eq('transaction_type', 'sale').gte('created_at', fromTs).lt('created_at', toExclusiveTs);
        if (effectiveBranchFilter) q = q.eq('branch_id', effectiveBranchFilter);
        q = filterQ(q, filters, applyProductScopedFilters);
        const tx = await fetchRows<Record<string, unknown>>(q);
        const map = new Map<string, { branchId: string; name: string; qty: number; cost: number; count: number }>();
        tx.forEach((row: Record<string, unknown>) => {
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
        const tx = await fetchRows<Record<string, unknown>>(q);
        const map = new Map<string, { branchId: string; name: string; qty: number }>();
        tx.forEach((row: Record<string, unknown>) => {
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
        const items = await fetchRows<Record<string, unknown>>(itemsQuery);
        const filtered = items.filter((item: Record<string, unknown>) => {
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
        const [rawMasters, rawBalances, unitMasters, unitBatches] = await Promise.all([
          fetchRows<Record<string, unknown>>(rawMasterQuery),
          fetchRows<Record<string, unknown>>(rawBalanceQuery),
          fetchRows<Record<string, unknown>>(unitMasterQuery),
          fetchRows<Record<string, unknown>>(unitBatchQuery),
        ]);
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
        let q = supabase.from('sales').select('branch_id, cashier_id, total, refunded_amount, payment_method, status, created_at, users:users!fk_sales_cashier(full_name, email)').gte('created_at', fromTs).lt('created_at', toExclusiveTs);
        if (effectiveBranchFilter) q = q.eq('branch_id', effectiveBranchFilter);
        const sales = await fetchRows<Record<string, unknown>>(q);
        const empMap = new Map<string, { branchId: string; name: string; total: number; count: number; refundCount: number }>();
        sales.forEach((sale: Record<string, unknown>) => {
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
        let q = supabase.from('sales').select('id, branch_id, invoice_number, total, refunded_amount, status, created_at, customer:customers(name), cashier:users!fk_sales_cashier(full_name)').gte('created_at', fromTs).lt('created_at', toExclusiveTs).or('refunded_amount.gt.0,status.in.(returned,refunded,cancelled)');
        if (effectiveBranchFilter) q = q.eq('branch_id', effectiveBranchFilter);
        const returns = await fetchRows<Record<string, unknown>>(q);
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
          const raw = (result.data as Record<string, unknown> | null) || {};
          if (result.error || raw.success === false) return;
          const branchId = targetBranchIds[index];
          const summaryRow = (raw.summary as Record<string, unknown> | null) || {};
          totalNetSales += Number(summaryRow.net_sales || 0);
          mismatchCount += Number(summaryRow.mismatch_count || 0);
          if (!Array.isArray(raw.rows)) return;
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
              [lang === 'ar' ? 'آجل' : 'Credit']: Number(row.credit || 0),
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
        const results = await Promise.all(targetBranches.map(async (branch) => {
          const result = await supabase.rpc('get_day_closing_range_report', {
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
        }));
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
      } else if (reportType === 'raw_material_consumption') {
        const targetBranches = effectiveBranchFilter
          ? branches.filter((branch) => branch.id === effectiveBranchFilter)
          : branches;
        const results = await Promise.all(targetBranches.map(async (branch) => {
          const result = await supabase.rpc('get_raw_material_consumption_report', {
            p_branch_id: branch.id,
            p_from_date: allowed.from,
            p_to_date: allowed.to,
          });
          if (result.error) throw result.error;
          return { branchId: branch.id, rows: Array.isArray(result.data) ? result.data as Record<string, unknown>[] : [] };
        }));
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
        setData(rows);
        setChartData([]);
        setSummary({
          total: rows.reduce((sum, row) => sum + Number(row[lang === 'ar' ? 'قيمة الاستهلاك' : 'Consumption Value'] || 0), 0),
          count: rows.length,
        });
      } else if (reportType === 'raw_material_current_cost') {
        const targetBranches = effectiveBranchFilter
          ? branches.filter((branch) => branch.id === effectiveBranchFilter)
          : branches;
        const results = await Promise.all(targetBranches.map(async (branch) => {
          const result = await supabase.rpc('get_current_raw_material_valuation', { p_branch_id: branch.id });
          if (result.error) throw result.error;
          return { branchId: branch.id, rows: Array.isArray(result.data) ? result.data as Record<string, unknown>[] : [] };
        }));
        const rows = results.flatMap(({ branchId, rows: rawRows }) => rawRows.map((row) => withBranch(branchId, {
          [lang === 'ar' ? 'الخامة' : 'Raw Material']: row.raw_material_name || '-',
          [lang === 'ar' ? 'الكود' : 'Code']: row.raw_material_code || '',
          [lang === 'ar' ? 'الوحدة' : 'Unit']: row.unit_name || '',
          [lang === 'ar' ? 'الكمية الحالية' : 'Current Qty']: Number(row.current_quantity || 0),
          [lang === 'ar' ? 'تكلفة الوحدة الحالية FIFO' : 'Current FIFO Unit Cost']: Number(row.fifo_current_unit_cost || 0),
          [lang === 'ar' ? 'قيمة المخزون الحالية' : 'Current Inventory Value']: Number(row.current_inventory_value || 0),
          [lang === 'ar' ? 'آخر تكلفة معتمدة' : 'Latest Authoritative Cost']: Number(row.latest_authoritative_cost || 0),
          [lang === 'ar' ? 'مصدر السعر' : 'Price Source']: row.price_source || '',
          [lang === 'ar' ? 'طبقات FIFO المفتوحة' : 'Open FIFO Batches']: Number(row.open_fifo_batches || 0),
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
        const results = await Promise.all(targetBranches.map(async (branch) => {
          const result = await supabase.rpc('get_raw_material_financial_report', {
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
        }));
        const rows = results.flatMap(({ branchId, summary: financial, rows: rawRows }) => {
          const summaryRow = withBranch(branchId, {
            [lang === 'ar' ? 'الخامة' : 'Raw Material']: lang === 'ar' ? 'إجمالي الفترة' : 'Period Total',
            [lang === 'ar' ? 'الوحدة' : 'Unit']: '—',
            [lang === 'ar' ? 'كمية أول المدة' : 'Opening Qty']: '—',
            [lang === 'ar' ? 'قيمة أول المدة' : 'Opening Value']: Number(financial.opening_inventory_value || 0),
            [lang === 'ar' ? 'كمية المشتريات' : 'Purchase Qty']: '—',
            [lang === 'ar' ? 'قيمة المشتريات' : 'Purchase Value']: Number(financial.purchases_value || 0),
            [lang === 'ar' ? 'صافي المبيعات' : 'Net Sales']: Number(financial.net_sales || 0),
            [lang === 'ar' ? 'كمية استهلاك المبيعات' : 'Sales Consumption Qty']: '—',
            [lang === 'ar' ? 'قيمة استهلاك المبيعات' : 'Sales Consumption Value']: Number(financial.sales_consumption_value || 0),
            [lang === 'ar' ? 'كمية آخر المدة' : 'Closing Qty']: '—',
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
      } else if (reportType === 'production_waste') {
        let q = supabase.from('waste_entries').select('id, branch_id, created_at, quantity, unit_cost, total_cost, reason, product:products(name), warehouse:warehouses(name)').gte('created_at', fromTs).lt('created_at', toExclusiveTs);
        if (effectiveBranchFilter) q = q.eq('branch_id', effectiveBranchFilter);
        const waste = await fetchRows<Record<string, unknown>>(q);
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
    } finally {
      setLoading(false);
    }
  }

  const handleExportExcel = () => {
    const excelProfile = getReportExcelProfile(reportType, lang as 'ar' | 'en');
    const isRawMaterialFinancial = reportType === 'raw_material_financial' && data.length > 0;
    const exportData = isRawMaterialFinancial ? data.slice(1) : data;
    const totalRow = isRawMaterialFinancial
      ? data[0]
      : reportType === 'financial_reconciliation'
        ? {
          [lang === 'ar' ? 'صافي المبيعات' : 'Net Sales']: summary.total,
          [lang === 'ar' ? 'عدد الفروق' : 'Mismatch Count']: summary.count,
        }
        : {
          [lang === 'ar' ? 'الإجمالي' : 'Total']: summary.total,
          [lang === 'ar' ? 'عدد السجلات' : 'Record Count']: summary.count,
        };
    void exportToExcelAdvanced({
      data: exportData,
      filename: `report_${reportType}_${from}_${to}`,
      sheetName: (reportTypes.find((row) => row.key === reportType)?.label ?? reportType).slice(0, 31),
      title: reportTypes.find((row) => row.key === reportType)?.label ?? reportType,
      subtitle: `${reportBranchLabel} — ${from} — ${to}`,
      totalRow,
      currencyColumns: moneyKeys,
      integerColumns: excelProfile.integerColumns,
      columns: excelProfile.columns,
      columnWidths: excelProfile.columnWidths,
      sourceNote: excelProfile.sourceNote,
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
  if (can('reports.costing') || canFinancial) {
    reportTypes.push(
      { key: 'raw_material_consumption', label: lang === 'ar' ? 'حركة واستهلاك الخامات' : 'Raw Material Consumption', icon: <Layers className="w-4 h-4" /> },
      { key: 'raw_material_current_cost', label: lang === 'ar' ? 'تكلفة الخامات الحالية' : 'Current Raw Material Cost', icon: <Package className="w-4 h-4" /> },
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
  ];

  const showDate = DATE_DRIVEN_REPORTS.has(reportType);
  const allColumns = data.length > 0 ? Object.keys(data[0]) : [];
  const columns = visibleColumns ? allColumns.filter((column) => visibleColumns.includes(column)) : allColumns;
  const hiddenCount = visibleColumns ? allColumns.length - columns.length : 0;
  const reportMobilePrimaryColumns = columns.slice(0, 4);
  const reportMobileSecondaryColumns = columns.slice(4);
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
      if (typeof value === 'number' && moneyKeys.includes(header)) return formatFinancialCurrency(value, currency, lang);
      return String(value ?? '');
    }));
    openPrintWindow({ title: reportLabel, subtitle: `${reportBranchLabel} — ${from} - ${to}`, headers, rows, lang: lang as 'ar' | 'en' });
  };

  return (
    <div>
      <ReportFilterBar
        reportType={reportType}
        filters={filters}
        onFilterChange={(dim, value) => {
          setFilters((prev) => ({ ...prev, [dim]: value }));
          setFiltersDirty(true);
        }}
        showDate={showDate}
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
        onRunReport={runReport}
        loading={loading}
        pendingChanges={filtersDirty}
        actions={
          <>
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
          </>
        }
      />

      <Card className="p-4 border-ui-border bg-ui-surface shadow-ui">
        {loading ? (
          <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" /></div>
        ) : data.length === 0 ? (
          <div className="text-center py-12 text-ui-subtle text-sm">{t('noData')}</div>
        ) : (
          <div>
            <div data-testid="reports-mobile-results" className="space-y-2 sm:hidden">
              {data.map((row, index) => (
                <article key={index} className="rounded-xl border border-ui-border bg-ui-surface p-3 shadow-ui-sm">
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
                  {data.map((row, index) => (
                    <tr key={index} className="border-b border-ui-border/60 hover:bg-ui-page-alt">
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
              </table>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
