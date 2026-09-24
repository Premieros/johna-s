import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Scale, BookOpen, TrendingUp, PieChart, Clock, Download, BadgeCheck, BadgeAlert, Landmark, ArrowLeftRight, Receipt, WalletCards, PackageSearch } from 'lucide-react';
import { supabase } from '@/api';
import * as api from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { DesignSurface, DesignPageHeader, DesignPanel } from '@/components/design';
import { Card } from '@/components/PageHeader';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';
import { formatCurrency, todayISO, formatDate } from '@/lib/format';
import { exportToExcelAdvanced } from '@/lib/excel';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useSettings } from '@/context/SettingsContext';
import { useHistoryAccess } from '@/lib/useHistoryAccess';
import type {
  TrialBalanceRow, GeneralLedgerRow, TrialBalanceSummary,
  IncomeStatementResult, BalanceSheetResult, ArAgingRow, ApAgingRow,
  AgingSummaryResult, CashFlowRow, PartyStatementResult,
  Customer, Supplier, ChartOfAccount, TreasuryStatementResult, InventoryItemStatementResult,
} from '@/lib/types';

type View = 'trial_balance' | 'ledger' | 'treasury_statement' | 'inventory_movement' | 'income' | 'balance_sheet' | 'ar_aging' | 'ap_aging' | 'aging_summary' | 'cash_flow' | 'party_statement';

export function FinancialReportsPage() {
  const { t, lang } = useLanguage();
  const branchFilter = useBranchFilter();
  const isAr = lang === 'ar';
  const [searchParams] = useSearchParams();
  const history = useHistoryAccess();

  const requestedView = searchParams.get('view');
  const validViews: View[] = ['trial_balance', 'ledger', 'treasury_statement', 'inventory_movement', 'income', 'balance_sheet', 'ar_aging', 'ap_aging', 'aging_summary', 'cash_flow', 'party_statement'];
  const initialView = validViews.includes(requestedView as View) ? (requestedView as View) : 'trial_balance';

  const [view, setView] = useState<View>(initialView);
  const [from, setFrom] = useState(() => history.clampRange(searchParams.get('from') || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10), searchParams.get('to') || todayISO()).from);
  const [to, setTo] = useState(() => history.clampRange(searchParams.get('from'), searchParams.get('to') || todayISO()).to);
  const [loading, setLoading] = useState(false);
  const { effectiveSettings } = useSettings();
  const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
  const [accountId, setAccountId] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [partySide, setPartySide] = useState<'ar' | 'ap'>('ar');
  const [partyId, setPartyId] = useState('');
  const [treasuryAccounts, setTreasuryAccounts] = useState<{ id: string; account_name: string; kind: string; scope: string }[]>([]);
  const [treasuryId, setTreasuryId] = useState('');
  const [inventoryItemType, setInventoryItemType] = useState<'product' | 'raw_material'>('product');
  const [inventoryItems, setInventoryItems] = useState<{ id: string; name: string }[]>([]);
  const [inventoryItemId, setInventoryItemId] = useState('');
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const effectiveBranchFilter = branchFilter;
  const currency = effectiveSettings(effectiveBranchFilter)?.currency || 'EGP';

  const [tb, setTb] = useState<TrialBalanceRow[]>([]);
  const [tbSummary, setTbSummary] = useState<TrialBalanceSummary | null>(null);
  const [gl, setGl] = useState<GeneralLedgerRow[]>([]);
  const [income, setIncome] = useState<IncomeStatementResult | null>(null);
  const [sheet, setSheet] = useState<BalanceSheetResult | null>(null);
  const [arAging, setArAging] = useState<ArAgingRow[]>([]);
  const [apAging, setApAging] = useState<ApAgingRow[]>([]);
  const [agingSummary, setAgingSummary] = useState<AgingSummaryResult | null>(null);
  const [cashFlow, setCashFlow] = useState<CashFlowRow[]>([]);
  const [partyStmt, setPartyStmt] = useState<PartyStatementResult | null>(null);
  const [treasuryStmt, setTreasuryStmt] = useState<TreasuryStatementResult | null>(null);
  const [inventoryStmt, setInventoryStmt] = useState<InventoryItemStatementResult | null>(null);

  useEffect(() => {
    if (!effectiveBranchFilter) {
      setAccounts([]);
      setAccountId('');
      setCustomers([]);
      setSuppliers([]);
      setTreasuryAccounts([]);
      setTreasuryId('');
      setInventoryItems([]);
      setInventoryItemId('');
      setWarehouses([]);
      setWarehouseId('');
      return;
    }

    if (view === 'ledger') {
      void supabase
        .from('chart_of_accounts')
        .select('id, code, name, name_en')
        .eq('branch_id', effectiveBranchFilter)
        .order('code')
        .then(({ data }) => {
          setAccounts((data as ChartOfAccount[]) || []);
          setAccountId((prev) => prev || (data?.[0]?.id as string) || '');
        });
    }

    if (view === 'treasury_statement') {
      void supabase
        .from('treasury_accounts')
        .select('id, account_name, kind, scope')
        .eq('branch_id', effectiveBranchFilter)
        .eq('is_active', true)
        .order('account_name')
        .then(({ data }) => {
          const rows = (data as { id: string; account_name: string; kind: string; scope: string }[]) || [];
          setTreasuryAccounts(rows);
          setTreasuryId((prev) => rows.some((x) => x.id === prev) ? prev : (rows[0]?.id || ''));
        });
    }

    if (view === 'inventory_movement') {
      const table = inventoryItemType === 'product' ? 'products' : 'raw_materials';
      void Promise.all([
        supabase.from(table).select('id, name').eq('branch_id', effectiveBranchFilter).eq('is_active', true).order('name'),
        supabase.from('warehouses').select('id, name').eq('branch_id', effectiveBranchFilter).eq('is_active', true).order('name'),
      ]).then(([items, wh]) => {
        const itemRows = (items.data as { id: string; name: string }[]) || [];
        setInventoryItems(itemRows);
        setInventoryItemId((prev) => itemRows.some((x) => x.id === prev) ? prev : (itemRows[0]?.id || ''));
        setWarehouses((wh.data as { id: string; name: string }[]) || []);
      });
    }

    if (view === 'party_statement') {
      if (partySide === 'ar') {
        void supabase
          .from('customers')
          .select('id, name, phone')
          .eq('branch_id', effectiveBranchFilter)
          .order('name')
          .then(({ data }) => setCustomers((data as Customer[]) || []));
      } else {
        void supabase
          .from('suppliers')
          .select('id, name, phone')
          .eq('branch_id', effectiveBranchFilter)
          .order('name')
          .then(({ data }) => setSuppliers((data as Supplier[]) || []));
      }
    }
  }, [effectiveBranchFilter, view, partySide, inventoryItemType]);

  const load = useCallback(async () => {
    if (!effectiveBranchFilter) {
      setTb([]); setTbSummary(null); setGl([]); setIncome(null); setSheet(null);
      setArAging([]); setApAging([]); setAgingSummary(null); setCashFlow([]); setPartyStmt(null); setTreasuryStmt(null); setInventoryStmt(null);
      return;
    }
    setLoading(true);
    try {
      const allowed = history.clampRange(from, to);
      if (allowed.from !== from) setFrom(allowed.from);
      if (allowed.to !== to) setTo(allowed.to);
      const safeFrom = allowed.from;
      const safeTo = allowed.to;
      if (view === 'trial_balance') {
        const { data } = await api.reporting.getTrialBalance({
          p_branch_id: effectiveBranchFilter,
          p_to_date: safeTo,
        });
        const rows = (data as TrialBalanceRow[]) || [];
        const totals = rows.reduce(
          (acc, row) => ({
            debit: acc.debit + Number(row.debit || 0),
            credit: acc.credit + Number(row.credit || 0),
          }),
          { debit: 0, credit: 0 },
        );
        const totalDebit = Math.round((totals.debit + Number.EPSILON) * 100) / 100;
        const totalCredit = Math.round((totals.credit + Number.EPSILON) * 100) / 100;
        setTb(rows);
        setTbSummary({
          to_date: safeTo,
          total_debit: totalDebit,
          total_credit: totalCredit,
          balanced: totalDebit === totalCredit,
        });
      } else if (view === 'ledger') {
        const { data } = await api.reporting.getGeneralLedger( {
          p_branch_id: effectiveBranchFilter,
          p_account_id: accountId || null,
          p_from_date: safeFrom,
          p_to_date: safeTo,
        });
        setGl((data as GeneralLedgerRow[]) || []);
      } else if (view === 'treasury_statement') {
        if (!treasuryId) { setTreasuryStmt(null); return; }
        const { data } = await api.reporting.getTreasuryAccountStatement({
          p_branch_id: effectiveBranchFilter,
          p_treasury_account_id: treasuryId,
          p_from_date: safeFrom,
          p_to_date: safeTo,
        });
        setTreasuryStmt((data as TreasuryStatementResult) || null);
      } else if (view === 'inventory_movement') {
        if (!inventoryItemId) { setInventoryStmt(null); return; }
        const { data } = await api.reporting.getInventoryItemStatement({
          p_branch_id: effectiveBranchFilter,
          p_item_type: inventoryItemType,
          p_item_id: inventoryItemId,
          p_warehouse_id: warehouseId || null,
          p_from_date: safeFrom || null,
          p_to_date: safeTo || null,
        });
        setInventoryStmt((data as InventoryItemStatementResult) || null);
      } else if (view === 'income') {
        const { data } = await api.reporting.getIncomeStatement( { p_branch_id: effectiveBranchFilter, p_from_date: safeFrom, p_to_date: safeTo });
        setIncome((data as IncomeStatementResult) || null);
      } else if (view === 'balance_sheet') {
        const { data } = await api.reporting.getBalanceSheet( { p_branch_id: effectiveBranchFilter, p_as_of: safeTo });
        setSheet((data as BalanceSheetResult) || null);
      } else if (view === 'ar_aging') {
        const { data } = await api.reporting.getArAging( { p_branch_id: effectiveBranchFilter, p_as_of: safeTo });
        setArAging((data as ArAgingRow[]) || []);
      } else if (view === 'ap_aging') {
        const { data } = await api.reporting.getApAging( { p_branch_id: effectiveBranchFilter, p_as_of: safeTo });
        setApAging((data as ApAgingRow[]) || []);
      } else if (view === 'aging_summary') {
        const { data } = await api.reporting.getAgingSummary( { p_branch_id: effectiveBranchFilter, p_as_of: safeTo });
        setAgingSummary((data as AgingSummaryResult) || null);
      } else if (view === 'cash_flow') {
        const { data } = await api.reporting.getCashFlow( { p_branch_id: effectiveBranchFilter, p_from_date: safeFrom, p_to_date: safeTo });
        setCashFlow((data as CashFlowRow[]) || []);
      } else if (view === 'party_statement') {
        const { data } = await api.reporting.getPartyStatement( {
          p_branch_id: effectiveBranchFilter,
          p_side: partySide,
          p_party_id: partyId || null,
          p_from_date: safeFrom || null,
          p_to_date: safeTo || null,
        });
        setPartyStmt((data as PartyStatementResult) || null);
      }
    } finally {
      setLoading(false);
    }
  }, [effectiveBranchFilter, view, to, accountId, from, partySide, partyId, treasuryId, inventoryItemType, inventoryItemId, warehouseId, history.unlimited]);

  useEffect(() => { load(); }, [load]);

  const views: { key: View; label: string; icon: React.ReactNode }[] = [
    { key: 'trial_balance', label: t('trialBalance'), icon: <Scale className="w-4 h-4" /> },
    { key: 'ledger', label: t('generalLedger'), icon: <BookOpen className="w-4 h-4" /> },
    { key: 'treasury_statement', label: isAr ? 'كشف حساب بنك / خزنة' : 'Bank / Treasury Statement', icon: <WalletCards className="w-4 h-4" /> },
    { key: 'inventory_movement', label: isAr ? 'حركة صنف' : 'Item Movement', icon: <PackageSearch className="w-4 h-4" /> },
    { key: 'income', label: t('incomeStatement'), icon: <TrendingUp className="w-4 h-4" /> },
    { key: 'balance_sheet', label: t('balanceSheet'), icon: <PieChart className="w-4 h-4" /> },
    { key: 'ar_aging', label: t('arAging'), icon: <Clock className="w-4 h-4" /> },
    { key: 'ap_aging', label: t('apAging'), icon: <Landmark className="w-4 h-4" /> },
    { key: 'aging_summary', label: t('agingSummary'), icon: <PieChart className="w-4 h-4" /> },
    { key: 'cash_flow', label: isAr ? 'ملخص حركة الخزائن والبنوك' : 'Treasury & Bank Movement Summary', icon: <ArrowLeftRight className="w-4 h-4" /> },
    { key: 'party_statement', label: t('partyStatement'), icon: <Receipt className="w-4 h-4" /> },
  ];

  const exportData = () => {
    const ar = (arabic: string, english: string) => isAr ? arabic : english;
    const currentTitle = views.find((item) => item.key === view)?.label || view;
    const base = {
      title: currentTitle,
      subtitle: `${from} — ${to}`,
      lang: lang as 'ar' | 'en',
      sourceNote: ar(
        'الأرقام من نفس RPC المحاسبي المستخدم في الشاشة؛ لا يعاد حسابها داخل ملف Excel.',
        'Figures use the same accounting RPC as the screen; Excel does not recompute them differently.',
      ),
    };

    if (view === 'trial_balance') {
      const rows = tb.map((r) => ({
        [ar('كود الحساب', 'Account Code')]: r.code,
        [ar('اسم الحساب', 'Account Name')]: isAr ? r.name : (r.name_en || r.name),
        [ar('نوع الحساب', 'Account Type')]: r.account_type,
        [ar('مدين', 'Debit')]: r.debit,
        [ar('دائن', 'Credit')]: r.credit,
        [ar('الرصيد', 'Balance')]: r.balance,
      }));
      void exportToExcelAdvanced({
        ...base, data: rows, filename: `trial_balance_${to}`, sheetName: currentTitle,
        currencyColumns: [ar('مدين', 'Debit'), ar('دائن', 'Credit'), ar('الرصيد', 'Balance')],
        columns: [ar('كود الحساب', 'Account Code'), ar('اسم الحساب', 'Account Name'), ar('نوع الحساب', 'Account Type'), ar('مدين', 'Debit'), ar('دائن', 'Credit'), ar('الرصيد', 'Balance')],
        columnWidths: { [ar('كود الحساب', 'Account Code')]: 14, [ar('اسم الحساب', 'Account Name')]: 30, [ar('نوع الحساب', 'Account Type')]: 18 },
        totalRow: { [ar('مدين', 'Debit')]: tbTotals.debit, [ar('دائن', 'Credit')]: tbTotals.credit, [ar('الرصيد', 'Balance')]: tbTotals.debit - tbTotals.credit },
      });
    } else if (view === 'ledger') {
      const rows = gl.map((r) => ({
        [ar('التاريخ', 'Date')]: r.entry_date,
        [ar('رقم القيد', 'Entry')]: r.entry_number,
        [ar('البيان', 'Description')]: r.description || '',
        [ar('المرجع', 'Reference')]: r.reference_number || '',
        [ar('مدين', 'Debit')]: r.debit,
        [ar('دائن', 'Credit')]: r.credit,
        [ar('الرصيد', 'Balance')]: r.balance,
      }));
      void exportToExcelAdvanced({
        ...base, data: rows, filename: `general_ledger_${to}`, sheetName: currentTitle,
        currencyColumns: [ar('مدين', 'Debit'), ar('دائن', 'Credit'), ar('الرصيد', 'Balance')],
        columns: [ar('التاريخ', 'Date'), ar('رقم القيد', 'Entry'), ar('البيان', 'Description'), ar('المرجع', 'Reference'), ar('مدين', 'Debit'), ar('دائن', 'Credit'), ar('الرصيد', 'Balance')],
        columnWidths: { [ar('التاريخ', 'Date')]: 16, [ar('رقم القيد', 'Entry')]: 18, [ar('البيان', 'Description')]: 38, [ar('المرجع', 'Reference')]: 20 },
      });
    } else if (view === 'treasury_statement' && treasuryStmt) {
      const rows = treasuryStmt.rows.map((r) => ({
        [ar('التاريخ', 'Date')]: r.entry_date,
        [ar('رقم القيد', 'Entry')]: r.entry_number,
        [ar('نوع الحركة', 'Movement')]: movementLabel(r.reference_type),
        [ar('المرجع', 'Reference')]: r.reference_number || '',
        [ar('البيان', 'Description')]: r.description || r.note || '',
        [ar('وارد', 'Inflow')]: r.inflow,
        [ar('منصرف', 'Outflow')]: r.outflow,
        [ar('الرصيد', 'Balance')]: r.balance,
      }));
      void exportToExcelAdvanced({
        ...base, data: rows, filename: `treasury_statement_${to}`, sheetName: currentTitle,
        currencyColumns: [ar('وارد', 'Inflow'), ar('منصرف', 'Outflow'), ar('الرصيد', 'Balance')],
        columns: [ar('التاريخ', 'Date'), ar('رقم القيد', 'Entry'), ar('نوع الحركة', 'Movement'), ar('المرجع', 'Reference'), ar('البيان', 'Description'), ar('وارد', 'Inflow'), ar('منصرف', 'Outflow'), ar('الرصيد', 'Balance')],
        columnWidths: { [ar('التاريخ', 'Date')]: 16, [ar('رقم القيد', 'Entry')]: 18, [ar('نوع الحركة', 'Movement')]: 18, [ar('المرجع', 'Reference')]: 20, [ar('البيان', 'Description')]: 38 },
        sourceNote: ar('الحركة من دفتر الأستاذ المرتبط بحساب الخزنة/البنك المختار.', 'Movement comes directly from the general ledger account linked to the selected treasury/bank account.'),
      });
    } else if (view === 'inventory_movement' && inventoryStmt) {
      const rows = inventoryStmt.rows.map((r) => ({
        [ar('التاريخ', 'Date')]: r.created_at,
        [ar('نوع الحركة', 'Type')]: r.entry_type,
        [ar('المخزن', 'Warehouse')]: r.warehouse_name || '',
        [ar('المرجع', 'Reference')]: r.reference_number || '',
        [ar('التشغيلة', 'Batch')]: r.batch_number || '',
        [ar('وارد', 'In')]: r.in_qty,
        [ar('منصرف', 'Out')]: r.out_qty,
        [ar('الرصيد', 'Balance')]: r.balance,
        [ar('تكلفة الوحدة', 'Unit Cost')]: r.unit_cost,
        [ar('إجمالي التكلفة', 'Total Cost')]: r.total_cost,
      }));
      void exportToExcelAdvanced({
        ...base, data: rows, filename: `inventory_movement_${to}`, sheetName: currentTitle,
        currencyColumns: [ar('تكلفة الوحدة', 'Unit Cost'), ar('إجمالي التكلفة', 'Total Cost')],
        columns: [ar('التاريخ', 'Date'), ar('نوع الحركة', 'Type'), ar('المخزن', 'Warehouse'), ar('المرجع', 'Reference'), ar('التشغيلة', 'Batch'), ar('وارد', 'In'), ar('منصرف', 'Out'), ar('الرصيد', 'Balance'), ar('تكلفة الوحدة', 'Unit Cost'), ar('إجمالي التكلفة', 'Total Cost')],
        columnWidths: { [ar('التاريخ', 'Date')]: 18, [ar('نوع الحركة', 'Type')]: 18, [ar('المخزن', 'Warehouse')]: 22, [ar('المرجع', 'Reference')]: 20, [ar('التشغيلة', 'Batch')]: 18 },
      });
    } else if (view === 'income' && income) {
      const rows = [
        { [ar('البند', 'Item')]: t('revenue'), [ar('القيمة', 'Amount')]: income.revenue },
        { [ar('البند', 'Item')]: t('discounts'), [ar('القيمة', 'Amount')]: income.discount },
        { [ar('البند', 'Item')]: t('netRevenue'), [ar('القيمة', 'Amount')]: income.net_revenue },
        { [ar('البند', 'Item')]: t('cogs'), [ar('القيمة', 'Amount')]: income.cogs },
        { [ar('البند', 'Item')]: t('grossProfit'), [ar('القيمة', 'Amount')]: income.gross_profit },
        { [ar('البند', 'Item')]: t('expenses'), [ar('القيمة', 'Amount')]: income.expenses },
        { [ar('البند', 'Item')]: t('netIncome'), [ar('القيمة', 'Amount')]: income.net_income },
      ];
      void exportToExcelAdvanced({ ...base, data: rows, filename: `income_statement_${to}`, sheetName: currentTitle, currencyColumns: [ar('القيمة', 'Amount')], columns: [ar('البند', 'Item'), ar('القيمة', 'Amount')], columnWidths: { [ar('البند', 'Item')]: 32 } });
    } else if (view === 'balance_sheet' && sheet) {
      const rows = [
        { [ar('البند', 'Item')]: t('assets'), [ar('القيمة', 'Amount')]: sheet.assets },
        { [ar('البند', 'Item')]: t('liabilities'), [ar('القيمة', 'Amount')]: sheet.liabilities },
        { [ar('البند', 'Item')]: t('equity'), [ar('القيمة', 'Amount')]: sheet.equity },
      ];
      void exportToExcelAdvanced({ ...base, data: rows, filename: `balance_sheet_${to}`, sheetName: currentTitle, currencyColumns: [ar('القيمة', 'Amount')], columns: [ar('البند', 'Item'), ar('القيمة', 'Amount')], columnWidths: { [ar('البند', 'Item')]: 32 } });
    } else if (view === 'ar_aging' || view === 'ap_aging') {
      const partyLabel = view === 'ar_aging' ? ar('العميل', 'Customer') : ar('المورد', 'Supplier');
      const source = view === 'ar_aging' ? arAging : apAging;
      const rows = source.map((r) => ({
        [partyLabel]: r.name,
        [ar('الهاتف', 'Phone')]: r.phone || '',
        [ar('الرصيد المفتوح', 'Open')]: r.open_amount,
        '0-30': r.bucket_0_30,
        '31-60': r.bucket_31_60,
        '61-90': r.bucket_61_90,
        '90+': r.bucket_90_plus,
      }));
      void exportToExcelAdvanced({
        ...base, data: rows, filename: `${view}_${to}`, sheetName: currentTitle,
        currencyColumns: [ar('الرصيد المفتوح', 'Open'), '0-30', '31-60', '61-90', '90+'],
        columns: [partyLabel, ar('الهاتف', 'Phone'), ar('الرصيد المفتوح', 'Open'), '0-30', '31-60', '61-90', '90+'],
        columnWidths: { [partyLabel]: 30, [ar('الهاتف', 'Phone')]: 18 },
      });
    } else if (view === 'aging_summary' && agingSummary) {
      const rows = [
        { [ar('البند', 'Item')]: ar('ذمم العملاء', 'AR'), [ar('القيمة', 'Amount')]: agingSummary.ar_open },
        { [ar('البند', 'Item')]: ar('ذمم الموردين', 'AP'), [ar('القيمة', 'Amount')]: agingSummary.ap_open },
      ];
      void exportToExcelAdvanced({ ...base, data: rows, filename: `aging_summary_${to}`, sheetName: currentTitle, currencyColumns: [ar('القيمة', 'Amount')], columns: [ar('البند', 'Item'), ar('القيمة', 'Amount')], columnWidths: { [ar('البند', 'Item')]: 30 } });
    } else if (view === 'cash_flow') {
      const rows = cashFlow.map((r) => ({
        [ar('الحساب', 'Account')]: r.account_name,
        [ar('النوع', 'Type')]: r.account_type,
        [ar('وارد', 'Inflow')]: r.inflow,
        [ar('منصرف', 'Outflow')]: r.outflow,
        [ar('الصافي', 'Net')]: r.net,
      }));
      void exportToExcelAdvanced({
        ...base, data: rows, filename: `cash_flow_${to}`, sheetName: currentTitle,
        currencyColumns: [ar('وارد', 'Inflow'), ar('منصرف', 'Outflow'), ar('الصافي', 'Net')],
        columns: [ar('الحساب', 'Account'), ar('النوع', 'Type'), ar('وارد', 'Inflow'), ar('منصرف', 'Outflow'), ar('الصافي', 'Net')],
        columnWidths: { [ar('الحساب', 'Account')]: 32, [ar('النوع', 'Type')]: 18 },
        sourceNote: ar('ملخص حركة حسابات الخزائن والبنوك من قيود الأستاذ فقط.', 'Summary of treasury and bank movements from ledger postings only.'),
      });
    } else if (view === 'party_statement' && partyStmt) {
      const rows = partyStmt.rows.map((r) => ({
        [ar('التاريخ', 'Date')]: r.entry_date,
        [ar('رقم القيد', 'Entry')]: r.entry_number,
        [ar('البيان', 'Description')]: r.description || '',
        [ar('المرجع', 'Reference')]: r.reference_number || '',
        [ar('مدين', 'Debit')]: r.debit,
        [ar('دائن', 'Credit')]: r.credit,
        [ar('الرصيد', 'Balance')]: r.balance,
      }));
      void exportToExcelAdvanced({
        ...base, data: rows, filename: `party_statement_${to}`, sheetName: currentTitle,
        currencyColumns: [ar('مدين', 'Debit'), ar('دائن', 'Credit'), ar('الرصيد', 'Balance')],
        columns: [ar('التاريخ', 'Date'), ar('رقم القيد', 'Entry'), ar('البيان', 'Description'), ar('المرجع', 'Reference'), ar('مدين', 'Debit'), ar('دائن', 'Credit'), ar('الرصيد', 'Balance')],
        columnWidths: { [ar('التاريخ', 'Date')]: 16, [ar('رقم القيد', 'Entry')]: 18, [ar('البيان', 'Description')]: 38, [ar('المرجع', 'Reference')]: 20 },
      });
    }
  };

  const summaryCard = (label: string, value: number, color = 'text-ui-text dark:text-white') => (
    <div className="bg-ui-page-alt/60 rounded-xl p-4">
      <p className="text-xs font-medium text-ui-subtle dark:text-ui-subtle">{label}</p>
      <p className={`text-lg font-bold mt-1 ${color}`}>{formatCurrency(value, currency, lang)}</p>
    </div>
  );

  const incomeRows: { label: string; value: number; bold?: boolean }[] = income ? [
    { label: t('revenue'), value: income.revenue },
    { label: t('discounts'), value: income.discount },
    { label: t('netRevenue'), value: income.net_revenue, bold: true },
    { label: t('cogs'), value: income.cogs },
    { label: t('grossProfit'), value: income.gross_profit, bold: true },
    { label: t('expenses'), value: income.expenses },
    { label: t('netIncome'), value: income.net_income, bold: true },
  ] : [];

  const tbTotals = tb.reduce((acc, r) => ({ debit: acc.debit + Number(r.debit), credit: acc.credit + Number(r.credit) }), { debit: 0, credit: 0 });

  const partyList = partySide === 'ar' ? customers : suppliers;
  const selectedLedgerAccount = accounts.find((a) => a.id === accountId);
  const ledgerIsAsset = selectedLedgerAccount?.account_type === 'asset';
  const movementLabel = (type: string | null | undefined) => {
    const labels: Record<string, [string, string]> = {
      sale: ['مبيعات', 'Sale'],
      purchase: ['مشتريات', 'Purchase'],
      expense: ['مصروف', 'Expense'],
      expense_reversal: ['عكس مصروف', 'Expense reversal'],
      customer_payment: ['تحصيل عميل', 'Customer payment'],
      supplier_payment: ['سداد مورد', 'Supplier payment'],
      treasury_transfer: ['تحويل خزينة', 'Treasury transfer'],
      transfer: ['تحويل', 'Transfer'],
      refund: ['مرتجع', 'Refund'],
      manual: ['قيد يدوي', 'Manual journal'],
    };
    const pair = labels[String(type || '')];
    return pair ? pair[isAr ? 0 : 1] : (type || '-');
  };

  return (
    <DesignSurface testId="financial-reports-page">
      <DesignPageHeader title={t('financialReports')} actions={<Button variant="outline" size="sm" onClick={exportData}><Download className="w-4 h-4" /> {t('exportExcel')}</Button>} />

      <DesignPanel testId="financial-reports-filters" className="ui-accent-finance">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {views.map((v) => (
              <button key={v.key} data-report-type={v.key} onClick={() => setView(v.key)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${view === v.key ? 'bg-brand-600 text-white' : 'bg-ui-page-alt text-ui-muted hover:bg-ui-page-alt dark:hover:bg-ui-page-alt'}`}>
                {v.icon} {v.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-4">
            {(view === 'ledger' || view === 'treasury_statement' || view === 'inventory_movement' || view === 'income' || view === 'cash_flow') && <Input label={t('from')} type="date" value={from} min={history.minDate} onChange={(e) => setFrom(history.clampRange(e.target.value, to).from)} />}
            <Input label={view === 'income' || view === 'ledger' || view === 'treasury_statement' || view === 'inventory_movement' || view === 'cash_flow' ? t('to') : t('asOf')} type="date" value={to} onChange={(e) => { const allowed = history.clampRange(from, e.target.value); setFrom(allowed.from); setTo(allowed.to); }} />
            {view === 'ledger' && accounts.length > 0 && (
              <Select label={t('accountName')} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">{t('allAccounts')}</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} - {isAr ? a.name : (a.name_en || a.name)}</option>)}
              </Select>
            )}
            {view === 'treasury_statement' && (
              <Select label={isAr ? 'الحساب' : 'Account'} value={treasuryId} onChange={(e) => setTreasuryId(e.target.value)}>
                <option value="">{isAr ? 'اختر البنك أو الخزنة' : 'Select bank or treasury'}</option>
                {treasuryAccounts.map((a) => <option key={a.id} value={a.id}>{a.account_name} · {a.kind === 'bank' ? (isAr ? 'بنك' : 'Bank') : (isAr ? 'خزنة' : 'Cash')}</option>)}
              </Select>
            )}
            {view === 'inventory_movement' && (
              <>
                <Select label={isAr ? 'نوع الصنف' : 'Item type'} value={inventoryItemType} onChange={(e) => { setInventoryItemType(e.target.value as 'product' | 'raw_material'); setInventoryItemId(''); }}>
                  <option value="product">{isAr ? 'منتج' : 'Product'}</option>
                  <option value="raw_material">{isAr ? 'خامة' : 'Raw material'}</option>
                </Select>
                <Select label={isAr ? 'الصنف' : 'Item'} value={inventoryItemId} onChange={(e) => setInventoryItemId(e.target.value)}>
                  <option value="">{isAr ? 'اختر الصنف' : 'Select item'}</option>
                  {inventoryItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </Select>
                <Select label={t('warehouse')} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                  <option value="">{isAr ? 'كل المخازن' : 'All warehouses'}</option>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </Select>
              </>
            )}
            {view === 'party_statement' && (
              <>
                <Select label={t('referenceType')} value={partySide} onChange={(e) => { setPartySide(e.target.value as 'ar' | 'ap'); setPartyId(''); }}>
                  <option value="ar">{t('customer')}</option>
                  <option value="ap">{t('supplier')}</option>
                </Select>
                <Select label={t('selectParty')} value={partyId} onChange={(e) => setPartyId(e.target.value)}>
                  <option value="">{t('selectParty')}</option>
                  {partyList.map((p) => <option key={p.id} value={p.id}>{isAr ? p.name : p.name}</option>)}
                </Select>
              </>
            )}
          </div>
        </div>
      </DesignPanel>

      {loading ? (
        <DesignPanel testId="financial-reports-loading"><div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" /></div></DesignPanel>
      ) : !effectiveBranchFilter ? (
        <DesignPanel testId="financial-reports-placeholder"><div className="text-center py-12 text-ui-subtle text-sm">{t('filterByBranch')}</div></DesignPanel>
      ) : view === 'trial_balance' ? (
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-6">
            {tbSummary?.balanced ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold bg-ui-success-soft text-ui-success  dark:text-ui-success"><BadgeCheck className="w-4 h-4" /> {t('balanced')}</span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold bg-ui-danger-soft text-ui-danger"><BadgeAlert className="w-4 h-4" /> {t('notBalanced')}</span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ui-border">
                  <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('accountCode')}</th>
                  <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('accountName')}</th>
                  <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('accountType')}</th>
                  <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{ledgerIsAsset ? (isAr ? 'وارد' : 'Inflow') : t('debit')}</th>
                  <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{ledgerIsAsset ? (isAr ? 'منصرف' : 'Outflow') : t('credit')}</th>
                  <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('balance')}</th>
                </tr>
              </thead>
              <tbody>
                {tb.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-ui-subtle">{t('noData')}</td></tr>}
                {tb.map((r) => (
                  <tr key={r.code} className="border-b border-ui-border hover:bg-ui-page-alt/50">
                    <td className="px-4 py-3 font-mono text-ui-text">{r.code}</td>
                    <td className="px-4 py-3 text-ui-text">{isAr ? r.name : (r.name_en || r.name)}</td>
                    <td className="px-4 py-3 text-ui-subtle dark:text-ui-subtle">{r.account_type}</td>
                    <td className="px-4 py-3 text-end text-ui-text">{r.debit > 0 ? formatCurrency(r.debit, currency, lang) : '-'}</td>
                    <td className="px-4 py-3 text-end text-ui-text">{r.credit > 0 ? formatCurrency(r.credit, currency, lang) : '-'}</td>
                    <td className={`px-4 py-3 text-end font-semibold ${r.balance < 0 ? 'text-ui-danger' : 'text-ui-text'}`}>{formatCurrency(r.balance, currency, lang)}</td>
                  </tr>
                ))}
                {tb.length > 0 && (
                  <tr className="bg-ui-page-alt/60 font-semibold text-ui-text">
                    <td className="px-4 py-3" colSpan={3}>{t('total')}</td>
                    <td className="px-4 py-3 text-end">{formatCurrency(tbTotals.debit, currency, lang)}</td>
                    <td className="px-4 py-3 text-end">{formatCurrency(tbTotals.credit, currency, lang)}</td>
                    <td className="px-4 py-3 text-end">{formatCurrency(tbTotals.debit - tbTotals.credit, currency, lang)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ) : view === 'ledger' ? (
        <Card className="p-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ui-border">
                  <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('date')}</th>
                  <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('entryNumber')}</th>
                  <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('description')}</th>
                  <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('reference')}</th>
                  <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('debit')}</th>
                  <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('credit')}</th>
                  <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('balance')}</th>
                </tr>
              </thead>
              <tbody>
                {gl.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-ui-subtle">{t('noData')}</td></tr>}
                {gl.map((r) => (
                  <tr key={r.line_id} className="border-b border-ui-border hover:bg-ui-page-alt/50">
                    <td className="px-4 py-3 text-ui-text">{r.entry_date}</td>
                    <td className="px-4 py-3 font-mono text-ui-text">{r.entry_number}</td>
                    <td className="px-4 py-3 text-ui-text">{r.description || '-'}</td>
                    <td className="px-4 py-3 text-ui-subtle dark:text-ui-subtle">{r.reference_number || '-'}</td>
                    <td className="px-4 py-3 text-end text-ui-text">{r.debit > 0 ? formatCurrency(r.debit, currency, lang) : '-'}</td>
                    <td className="px-4 py-3 text-end text-ui-text">{r.credit > 0 ? formatCurrency(r.credit, currency, lang) : '-'}</td>
                    <td className="px-4 py-3 text-end font-semibold text-ui-text">{formatCurrency(r.balance, currency, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : view === 'treasury_statement' ? (
        <Card className="p-4">
          {treasuryStmt && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
                {summaryCard(isAr ? 'رصيد أول المدة' : 'Opening balance', treasuryStmt.opening_balance)}
                {summaryCard(isAr ? 'إجمالي الوارد' : 'Total inflow', treasuryStmt.total_inflow, 'text-ui-success')}
                {summaryCard(isAr ? 'إجمالي المنصرف' : 'Total outflow', treasuryStmt.total_outflow, 'text-ui-danger')}
                {summaryCard(isAr ? 'رصيد آخر المدة' : 'Closing balance', treasuryStmt.closing_balance)}
              </div>
              <p className="text-sm text-ui-muted mb-3">{isAr ? 'هذا كشف حركة مفهوم للبنك أو الخزنة: الوارد يزيد الرصيد والمنصرف يخفضه. لا توجد تسمية Credit كطريقة دفع.' : 'Readable bank/treasury movement: inflow increases balance and outflow decreases it.'}</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-ui-border">
                    <th className="px-3 py-3 text-start">{t('date')}</th>
                    <th className="px-3 py-3 text-start">{isAr ? 'المصدر' : 'Source'}</th>
                    <th className="px-3 py-3 text-start">{t('reference')}</th>
                    <th className="px-3 py-3 text-start">{t('description')}</th>
                    <th className="px-3 py-3 text-end">{isAr ? 'وارد' : 'Inflow'}</th>
                    <th className="px-3 py-3 text-end">{isAr ? 'منصرف' : 'Outflow'}</th>
                    <th className="px-3 py-3 text-end">{t('balance')}</th>
                  </tr></thead>
                  <tbody>
                    {treasuryStmt.rows.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-ui-subtle">{t('noData')}</td></tr>}
                    {treasuryStmt.rows.map((r) => <tr key={String(r.line_id)} className="border-b border-ui-border">
                      <td className="px-3 py-3">{formatDate(r.entry_date, lang)}</td>
                      <td className="px-3 py-3">{movementLabel(r.reference_type)}</td>
                      <td className="px-3 py-3">{r.reference_number || '-'}</td>
                      <td className="px-3 py-3">{r.description || r.note || '-'}</td>
                      <td className="px-3 py-3 text-end text-ui-success">{r.inflow > 0 ? formatCurrency(r.inflow, currency, lang) : '-'}</td>
                      <td className="px-3 py-3 text-end text-ui-danger">{r.outflow > 0 ? formatCurrency(r.outflow, currency, lang) : '-'}</td>
                      <td className="px-3 py-3 text-end font-semibold">{formatCurrency(r.balance, currency, lang)}</td>
                    </tr>)}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      ) : view === 'inventory_movement' ? (
        <Card className="p-4">
          {inventoryStmt && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
                <div className="bg-ui-page-alt/60 rounded-xl p-4"><p className="text-xs text-ui-subtle">{isAr ? 'رصيد أول المدة' : 'Opening qty'}</p><p className="text-lg font-bold mt-1">{inventoryStmt.opening_quantity}</p></div>
                <div className="bg-ui-page-alt/60 rounded-xl p-4"><p className="text-xs text-ui-subtle">{isAr ? 'إجمالي الوارد' : 'Total in'}</p><p className="text-lg font-bold mt-1 text-ui-success">{inventoryStmt.total_in}</p></div>
                <div className="bg-ui-page-alt/60 rounded-xl p-4"><p className="text-xs text-ui-subtle">{isAr ? 'إجمالي المنصرف' : 'Total out'}</p><p className="text-lg font-bold mt-1 text-ui-danger">{inventoryStmt.total_out}</p></div>
                <div className="bg-ui-page-alt/60 rounded-xl p-4"><p className="text-xs text-ui-subtle">{isAr ? 'الرصيد الحالي للفترة' : 'Closing qty'}</p><p className="text-lg font-bold mt-1">{inventoryStmt.closing_quantity}</p></div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-ui-border">
                    <th className="px-3 py-3 text-start">{t('date')}</th>
                    <th className="px-3 py-3 text-start">{isAr ? 'نوع الحركة' : 'Movement'}</th>
                    <th className="px-3 py-3 text-start">{t('warehouse')}</th>
                    <th className="px-3 py-3 text-start">{t('reference')}</th>
                    <th className="px-3 py-3 text-end">{isAr ? 'وارد' : 'In'}</th>
                    <th className="px-3 py-3 text-end">{isAr ? 'منصرف' : 'Out'}</th>
                    <th className="px-3 py-3 text-end">{t('balance')}</th>
                    <th className="px-3 py-3 text-end">{t('unitCost')}</th>
                  </tr></thead>
                  <tbody>
                    {inventoryStmt.rows.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-ui-subtle">{t('noData')}</td></tr>}
                    {inventoryStmt.rows.map((r) => <tr key={String(r.id)} className="border-b border-ui-border">
                      <td className="px-3 py-3">{formatDate(r.created_at, lang)}</td>
                      <td className="px-3 py-3">{r.entry_type}</td>
                      <td className="px-3 py-3">{r.warehouse_name || '-'}</td>
                      <td className="px-3 py-3">{r.reference_number || '-'}</td>
                      <td className="px-3 py-3 text-end text-ui-success">{r.in_qty > 0 ? r.in_qty : '-'}</td>
                      <td className="px-3 py-3 text-end text-ui-danger">{r.out_qty > 0 ? r.out_qty : '-'}</td>
                      <td className="px-3 py-3 text-end font-semibold">{r.balance}</td>
                      <td className="px-3 py-3 text-end">{formatCurrency(r.unit_cost, currency, lang)}</td>
                    </tr>)}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      ) : view === 'income' ? (
        <Card className="p-4">
          {income && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              {summaryCard(t('revenue'), income.revenue)}
              {summaryCard(t('cogs'), income.cogs)}
              {summaryCard(t('grossProfit'), income.gross_profit, 'text-brand-600 dark:text-brand-400')}
              {summaryCard(t('netIncome'), income.net_income, income.net_income >= 0 ? 'text-ui-success dark:text-ui-success' : 'text-ui-danger')}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {incomeRows.map((r) => (
                  <tr key={r.label} className={`border-b border-ui-border ${r.bold ? 'bg-ui-page-alt/60' : ''}`}>
                    <td className="px-4 py-3 text-ui-text font-medium">{r.label}</td>
                    <td className={`px-4 py-3 text-end ${r.bold ? 'font-bold text-ui-text dark:text-white' : 'text-ui-text'}`}>{formatCurrency(r.value, currency, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : view === 'balance_sheet' ? (
        <Card className="p-4">
          {sheet && (
            <>
              <div className="flex items-center gap-2 mb-6">
                {sheet.balanced ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold bg-ui-success-soft text-ui-success  dark:text-ui-success"><BadgeCheck className="w-4 h-4" /> {t('balanced')}</span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold bg-ui-danger-soft text-ui-danger"><BadgeAlert className="w-4 h-4" /> {t('notBalanced')}</span>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {summaryCard(t('assets'), sheet.assets)}
                {summaryCard(t('liabilities'), sheet.liabilities)}
                {summaryCard(t('equity'), sheet.equity)}
                {summaryCard(t('capital'), sheet.capital)}
                {summaryCard(t('retainedEarnings'), sheet.retained)}
                {summaryCard(t('netIncome'), sheet.net_income, 'text-brand-600 dark:text-brand-400')}
              </div>
            </>
          )}
        </Card>
      ) : view === 'ar_aging' ? (
        <Card className="p-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ui-border">
                  <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('customer')}</th>
                  <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('phone')}</th>
                  <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('openBalance')}</th>
                  <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('days30')}</th>
                  <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('days60')}</th>
                  <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('days90')}</th>
                  <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('days90Plus')}</th>
                </tr>
              </thead>
              <tbody>
                {arAging.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-ui-subtle">{t('noData')}</td></tr>}
                {arAging.map((r) => (
                  <tr key={r.customer_id} className="border-b border-ui-border hover:bg-ui-page-alt/50">
                    <td className="px-4 py-3 font-medium text-ui-text">{r.name}</td>
                    <td className="px-4 py-3 text-ui-subtle dark:text-ui-subtle">{r.phone || '-'}</td>
                    <td className="px-4 py-3 text-end font-semibold text-ui-danger">{formatCurrency(r.open_amount, currency, lang)}</td>
                    <td className="px-4 py-3 text-end text-ui-text">{formatCurrency(r.bucket_0_30, currency, lang)}</td>
                    <td className="px-4 py-3 text-end text-ui-text">{formatCurrency(r.bucket_31_60, currency, lang)}</td>
                    <td className="px-4 py-3 text-end text-ui-text">{formatCurrency(r.bucket_61_90, currency, lang)}</td>
                    <td className={`px-4 py-3 text-end ${r.bucket_90_plus > 0 ? 'text-ui-danger font-semibold' : 'text-ui-text'}`}>{formatCurrency(r.bucket_90_plus, currency, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : view === 'ap_aging' ? (
        <Card className="p-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ui-border">
                  <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('supplier')}</th>
                  <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('phone')}</th>
                  <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('openBalance')}</th>
                  <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('days30')}</th>
                  <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('days60')}</th>
                  <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('days90')}</th>
                  <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('days90Plus')}</th>
                </tr>
              </thead>
              <tbody>
                {apAging.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-ui-subtle">{t('noData')}</td></tr>}
                {apAging.map((r) => (
                  <tr key={r.supplier_id} className="border-b border-ui-border hover:bg-ui-page-alt/50">
                    <td className="px-4 py-3 font-medium text-ui-text">{r.name}</td>
                    <td className="px-4 py-3 text-ui-subtle dark:text-ui-subtle">{r.phone || '-'}</td>
                    <td className="px-4 py-3 text-end font-semibold text-ui-danger">{formatCurrency(r.open_amount, currency, lang)}</td>
                    <td className="px-4 py-3 text-end text-ui-text">{formatCurrency(r.bucket_0_30, currency, lang)}</td>
                    <td className="px-4 py-3 text-end text-ui-text">{formatCurrency(r.bucket_31_60, currency, lang)}</td>
                    <td className="px-4 py-3 text-end text-ui-text">{formatCurrency(r.bucket_61_90, currency, lang)}</td>
                    <td className={`px-4 py-3 text-end ${r.bucket_90_plus > 0 ? 'text-ui-danger font-semibold' : 'text-ui-text'}`}>{formatCurrency(r.bucket_90_plus, currency, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : view === 'aging_summary' ? (
        <Card className="p-4">
          {agingSummary && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                {summaryCard(t('arTotal'), agingSummary.ar_open, 'text-ui-info')}
                {summaryCard(t('apTotal'), agingSummary.ap_open, 'text-ui-warning')}
                {summaryCard(t('openBalance'), agingSummary.ar_open + agingSummary.ap_open)}
                <div className="bg-ui-page-alt/60 rounded-xl p-4">
                  <p className="text-xs font-medium text-ui-subtle dark:text-ui-subtle">{t('asOf')}</p>
                  <p className="text-lg font-bold mt-1 text-ui-text dark:text-white">{formatDate(agingSummary.as_of, lang)}</p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-ui-border">
                      <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('days30')}</th>
                      <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('days60')}</th>
                      <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('days90')}</th>
                      <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('days90Plus')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-ui-border">
                      <td className="px-4 py-3 font-medium text-ui-text">{t('arTotal')}</td>
                      <td className="px-4 py-3 text-end text-ui-text">{formatCurrency(agingSummary.ar['0_30'], currency, lang)}</td>
                      <td className="px-4 py-3 text-end text-ui-text">{formatCurrency(agingSummary.ar['31_60'], currency, lang)}</td>
                      <td className="px-4 py-3 text-end text-ui-text">{formatCurrency(agingSummary.ar['61_90'], currency, lang)}</td>
                      <td className="px-4 py-3 text-end text-ui-text">{formatCurrency(agingSummary.ar['90_plus'], currency, lang)}</td>
                    </tr>
                    <tr className="border-b border-ui-border">
                      <td className="px-4 py-3 font-medium text-ui-text">{t('apTotal')}</td>
                      <td className="px-4 py-3 text-end text-ui-text">{formatCurrency(agingSummary.ap['0_30'], currency, lang)}</td>
                      <td className="px-4 py-3 text-end text-ui-text">{formatCurrency(agingSummary.ap['31_60'], currency, lang)}</td>
                      <td className="px-4 py-3 text-end text-ui-text">{formatCurrency(agingSummary.ap['61_90'], currency, lang)}</td>
                      <td className="px-4 py-3 text-end text-ui-text">{formatCurrency(agingSummary.ap['90_plus'], currency, lang)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      ) : view === 'cash_flow' ? (
        <Card className="p-4">
          <p className="mb-4 text-sm text-ui-muted">{isAr ? 'ملخص من نفس القيود اليومية المستخدمة في كشف حساب البنك والخزنة. الوارد = مدين حساب الخزنة، والمنصرف = دائن حساب الخزنة.' : 'Summary from the same journal source used by bank/treasury statements.'}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ui-border">
                  <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('accountName')}</th>
                  <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('accountType')}</th>
                  <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('inflow')}</th>
                  <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('outflow')}</th>
                  <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('netFlow')}</th>
                </tr>
              </thead>
              <tbody>
                {cashFlow.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-ui-subtle">{t('noData')}</td></tr>}
                {cashFlow.map((r) => (
                  <tr key={r.treasury_account_id} className="border-b border-ui-border hover:bg-ui-page-alt/50">
                    <td className="px-4 py-3 font-medium text-ui-text">{r.account_name}</td>
                    <td className="px-4 py-3 text-ui-subtle dark:text-ui-subtle">{r.account_type === 'cash' ? t('cash') : t('bank')}</td>
                    <td className="px-4 py-3 text-end text-ui-success dark:text-ui-success">{formatCurrency(r.inflow, currency, lang)}</td>
                    <td className="px-4 py-3 text-end text-ui-danger">{formatCurrency(r.outflow, currency, lang)}</td>
                    <td className={`px-4 py-3 text-end font-semibold ${r.net < 0 ? 'text-ui-danger' : 'text-ui-text'}`}>{formatCurrency(r.net, currency, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card className="p-4">
          {partyStmt && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                {summaryCard(t('openingBalance'), partyStmt.opening)}
                {summaryCard(t('runningBalance'), partyStmt.rows.length ? partyStmt.rows[partyStmt.rows.length - 1].balance : partyStmt.opening)}
                <div className="bg-ui-page-alt/60 rounded-xl p-4">
                  <p className="text-xs font-medium text-ui-subtle dark:text-ui-subtle">{t('asOf')}</p>
                  <p className="text-lg font-bold mt-1 text-ui-text dark:text-white">{formatDate(to, lang)}</p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-ui-border">
                      <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('date')}</th>
                      <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('entryNumber')}</th>
                      <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('description')}</th>
                      <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('debit')}</th>
                      <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('credit')}</th>
                      <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('balance')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {partyStmt.rows.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-ui-subtle">{t('noData')}</td></tr>}
                    {partyStmt.rows.map((r) => (
                      <tr key={r.line_id} className="border-b border-ui-border hover:bg-ui-page-alt/50">
                        <td className="px-4 py-3 text-ui-muted">{formatDate(r.entry_date, lang)}</td>
                        <td className="px-4 py-3 font-mono text-ui-text">{r.entry_number}</td>
                        <td className="px-4 py-3 text-ui-text">{r.description || '-'}</td>
                        <td className="px-4 py-3 text-end text-ui-text">{r.debit > 0 ? formatCurrency(r.debit, currency, lang) : '-'}</td>
                        <td className="px-4 py-3 text-end text-ui-text">{r.credit > 0 ? formatCurrency(r.credit, currency, lang) : '-'}</td>
                        <td className="px-4 py-3 text-end font-semibold text-ui-text">{formatCurrency(r.balance, currency, lang)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      )}
    </DesignSurface>
  );
}