import { useEffect, useState, useCallback, useMemo } from 'react';
import { Landmark, ArrowLeftRight, PiggyBank, HandCoins, Wallet, FileText } from 'lucide-react';
import * as api from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { DesignSurface, DesignPageHeader, DesignPanel, DesignPagination } from '@/components/design';
import { StatCard } from '@/components/PageHeader';
import { DataTable, type Column } from '@/components/DataTable';
import { Button } from '@/components/Button';
import { Input, Select, Textarea } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { logAudit } from '@/lib/audit';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useCan } from '@/lib/permissions';
import { useHistoryAccess } from '@/lib/useHistoryAccess';
import { isAdminRole } from '@/lib/permissions';
import { useSettings } from '@/context/SettingsContext';
import { useBranches } from '@/hooks/useBranches';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import type { TreasurySource, TreasuryTransaction } from '@/lib/types';
import { buildA4DayClosingReportHtml, fetchDayClosingReportServer } from '@/features/trade/services/dayClosingReport';

type ModalType = 'transfer' | 'deposit' | 'withdrawal' | null;
type TreasuryScopeView = 'branch' | 'main';

interface TreasuryMovementRow {
  journal_entry_id: string;
  created_at: string;
  reference_type: string;
  reference_id: string | null;
  reference_number: string | null;
  description: string | null;
  cash_effect: number;
  bank_effect: number;
  total_effect: number;
}

interface TreasuryDayCloseRow {
  id?: string;
  daily_close_id: string;
  business_date: string;
  closed_at: string;
  movement_until: string;
  is_latest: boolean;
  cash_sales: number;
  bank_sales: number;
  credit_sales: number;
  net_sales: number;
  expenses: number;
  cash_purchases: number;
  transfer_in: number;
  transfer_out: number;
  shift_cash_net: number;
  cash_day_net: number;
  opening_balance: number;
  cash_opening_balance: number;
  bank_opening_balance: number;
  day_net: number;
  closing_balance: number;
  cash_balance_after_close: number;
  bank_balance_after_close: number;
  total_balance_after_close: number;
  cash_movement_after_close: number;
  bank_movement_after_close: number;
  total_movement_after_close: number;
  cash_balance_after_movement: number;
  bank_balance_after_movement: number;
  total_balance_after_movement: number;
  movement_details: TreasuryMovementRow[];
}

type TreasuryDailyDisplayRow = TreasuryDayCloseRow;

export function TreasuryPage() {
  const { t, lang } = useLanguage();
  const { show } = useToast();
  const { user } = useAuth();
  const branchFilter = useBranchFilter();
  const can = useCan();
  const history = useHistoryAccess();
  const { effectiveSettings } = useSettings();
  const { branches } = useBranches();
  const isAr = lang === 'ar';

  const [balances, setBalances] = useState<TreasurySource[]>([]);
  const [accounts, setAccounts] = useState<TreasurySource[]>([]);
  const [loading, setLoading] = useState(true);
  const [adminBranchFilter, setAdminBranchFilter] = useState('');
  const [dayCloses, setDayCloses] = useState<TreasuryDayCloseRow[]>([]);
  const [treasuryView, setTreasuryView] = useState<TreasuryScopeView>('branch');
  const dailyColumnOptions = [
    'business_date','cash_opening_balance','bank_opening_balance','shift_cash_net','cash_day_net','cash_sales','bank_sales','credit_sales','cash_purchases','expenses','transfer_in','transfer_out','cash_balance_after_close','bank_balance_after_close','closing_balance','report',
  ] as const;
  type DailyColumnKey = typeof dailyColumnOptions[number];
  const dailyColumnStorageKey = 'treasury.dailyJournal.columns.v2';
  const [visibleDailyColumns, setVisibleDailyColumns] = useState<DailyColumnKey[]>(() => {
    try {
      const raw = window.localStorage.getItem(dailyColumnStorageKey);
      const parsed = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed) ? parsed.filter((key): key is DailyColumnKey => dailyColumnOptions.includes(key)) : [...dailyColumnOptions];
    } catch {
      return [...dailyColumnOptions];
    }
  });
  const [selectedDay, setSelectedDay] = useState<TreasuryDailyDisplayRow | null>(null);

  useEffect(() => {
    if (!isAdminRole(user?.role) || adminBranchFilter || branches.length === 0) return;
    const preferred = user?.branch_id && branches.some((b) => b.id === user.branch_id)
      ? user.branch_id
      : branches[0].id;
    setAdminBranchFilter(preferred);
  }, [user?.role, user?.branch_id, branches, adminBranchFilter]);

  useEffect(() => {
    window.localStorage.setItem(dailyColumnStorageKey, JSON.stringify(visibleDailyColumns));
  }, [visibleDailyColumns]);

  const effectiveBranchFilter = isAdminRole(user?.role) ? (adminBranchFilter || null) : branchFilter;
  const currency = effectiveSettings(effectiveBranchFilter)?.currency || 'EGP';
  const mainTreasuryAccounts = balances.filter((b) => b.scope === 'organization');
  const mainTreasuryBalance = mainTreasuryAccounts.reduce((sum, account) => sum + Number(account.balance || 0), 0);
  const mainAccountIds = mainTreasuryAccounts.map((account) => account.id);
  const transactionScope = treasuryView === 'main'
    ? (mainAccountIds.length > 0 ? `from_account_id.in.(${mainAccountIds.join(',')}),to_account_id.in.(${mainAccountIds.join(',')})` : undefined)
    : (effectiveBranchFilter
      ? `branch_id.eq.${effectiveBranchFilter},from_branch_id.eq.${effectiveBranchFilter},to_branch_id.eq.${effectiveBranchFilter}`
      : undefined);
  const { rows: transactions, loading: txLoading, error: txError, total: txTotal, hasMore: txHasMore, loadMore: loadMoreTx, loadingMore: loadingMoreTx, refresh: reloadTx } = usePaginatedRows<TreasuryTransaction>({
    table: 'treasury_transactions',
    select: '*, from_account:treasury_accounts!from_account_id(account_name,branch_id,scope,kind), to_account:treasury_accounts!to_account_id(account_name,branch_id,scope,kind)',
    order: { column: 'created_at', ascending: false },
    or: transactionScope,
    min: history.minIso ? { column: 'created_at', value: history.minIso } : undefined,
    pageSize: 100,
    enabled: treasuryView === 'main' ? mainAccountIds.length > 0 : !!effectiveBranchFilter,
  });

  const [modal, setModal] = useState<ModalType>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ from_account_id: '', to_account_id: '', account_id: '', amount: '', notes: '' });

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      if (effectiveBranchFilter) {
        const { data } = await api.accounting.getAccessibleTreasuryAccounts({
          p_branch_id: effectiveBranchFilter,
        });
        const sourceRows = (data as TreasurySource[]) || [];
        setBalances(sourceRows);
        setAccounts(sourceRows);
        const { data: closeData } = await api.accounting.getBranchTreasuryDayCloseReconciliation({
          p_branch_id: effectiveBranchFilter,
          p_limit: 60,
        });
        const closePayload = closeData as { success?: boolean; rows?: TreasuryDayCloseRow[] } | null;
        setDayCloses(closePayload?.success ? (closePayload.rows || []) : []);
      } else {
        setBalances([]);
        setAccounts([]);
        setDayCloses([]);
      }
    } finally {
      setLoading(false);
    }
  }, [effectiveBranchFilter]);

  useEffect(() => { void loadOverview(); }, [loadOverview]);

  const openDayCloseDetail = async (row: TreasuryDayCloseRow) => {
    if (!effectiveBranchFilter) return;
    try {
      const report = await fetchDayClosingReportServer(effectiveBranchFilter, row.business_date);
      const html = buildA4DayClosingReportHtml(report, currency, lang);
      const w = window.open('', '_blank', 'width=1000,height=850');
      if (!w) {
        show(isAr ? 'تعذر فتح تقرير إغلاق اليوم. اسمح بالنوافذ المنبثقة ثم حاول مرة أخرى.' : 'Could not open the day-closing report. Allow pop-ups and try again.', 'error');
        return;
      }
      w.document.write(html);
      w.document.close();
    } catch (err: unknown) {
      show(err instanceof Error ? err.message : (isAr ? 'تعذر تحميل تقرير إغلاق اليوم' : 'Could not load day-closing report'), 'error');
    }
  };

  const openModal = (m: Exclude<ModalType, null>) => {
    setForm({ from_account_id: '', to_account_id: '', account_id: '', amount: '', notes: '' });
    setModal(m);
  };

  const submit = async () => {
    const amount = Number(form.amount);
    if (!amount || amount <= 0) { show(t('required'), 'error'); return; }
    if (!effectiveBranchFilter) { show(t('filterByBranch'), 'error'); return; }
    setSaving(true);
    let result: { data: unknown; error: { message: string } | null };
    if (modal === 'transfer') {
      if (!form.from_account_id || !form.to_account_id) { setSaving(false); show(t('required'), 'error'); return; }
      result = await api.accounting.processTreasuryTransferV2({
        p_from_account_id: form.from_account_id,
        p_to_account_id: form.to_account_id,
        p_amount: amount,
        p_notes: form.notes || null,
      });
    } else if (modal === 'deposit') {
      if (!form.account_id) { setSaving(false); show(t('required'), 'error'); return; }
      result = await api.accounting.processTreasuryDeposit({
        p_branch_id: effectiveBranchFilter,
        p_account_id: form.account_id,
        p_amount: amount,
        p_notes: form.notes || null,
      });
    } else {
      if (!form.account_id) { setSaving(false); show(t('required'), 'error'); return; }
      result = await api.accounting.processTreasuryWithdrawal({
        p_branch_id: effectiveBranchFilter,
        p_account_id: form.account_id,
        p_amount: amount,
        p_notes: form.notes || null,
      });
    }
    setSaving(false);
    const { data, error } = result as { data: { success: boolean; error?: string; detail?: string; reference_number?: string } | null; error: { message: string } | null };
    if (error) { show(error.message, 'error'); return; }
    if (!data?.success) { show(data?.detail || data?.error || t('error'), 'error'); return; }
    show(`${formatCurrency(amount, currency, lang)} (${data.reference_number || ''})`, 'success');
    await logAudit('create', 'treasury_transactions', undefined, { type: modal, amount, reference: data.reference_number });
    setModal(null);
    void loadOverview();
    reloadTx();
  };

  const localAccounts = accounts.filter(
    (a) => a.scope === 'branch' && a.branch_id === effectiveBranchFilter,
  );
  const totalCash = localAccounts.filter((b) => b.account_type === 'cash').reduce((s, b) => s + Number(b.balance), 0);
  const totalBank = localAccounts.filter((b) => b.account_type === 'bank').reduce((s, b) => s + Number(b.balance), 0);
  const dailyRows = useMemo<TreasuryDailyDisplayRow[]>(() => dayCloses.map((row) => ({
    ...row,
    opening_balance: Number(row.opening_balance || 0),
    day_net: Number(row.day_net || 0),
    shift_cash_net: Number(row.shift_cash_net || 0),
    cash_day_net: Number(row.cash_day_net || 0),
    closing_balance: Number(row.closing_balance || 0),
  })), [dayCloses]);
  const periodTotals = useMemo(() => {
    const sum = (key: keyof TreasuryDailyDisplayRow) => dailyRows.reduce((total, row) => total + Number(row[key] || 0), 0);
    return {
      cash_sales: sum('cash_sales'),
      bank_sales: sum('bank_sales'),
      credit_sales: sum('credit_sales'),
      expenses: sum('expenses'),
      cash_purchases: sum('cash_purchases'),
      transfer_in: sum('transfer_in'),
      transfer_out: sum('transfer_out'),
      latest_cash: dailyRows[0]?.cash_balance_after_close || 0,
      latest_bank: dailyRows[0]?.bank_balance_after_close || 0,
      latest_total: dailyRows[0]?.closing_balance || 0,
    };
  }, [dailyRows]);

  const displayedBalances = treasuryView === 'main'
    ? mainTreasuryAccounts
    : localAccounts;
  const accountLabel = (a: TreasurySource) => {
    if (a.scope === 'organization') return isAr ? 'الخزنة الرئيسية' : 'Main Treasury';
    return `${a.branch_name || ''} - ${a.account_name}`.replace(/^ - /, '');
  };

  const balanceColumns: Column<TreasurySource>[] = [
    { key: 'account_name', header: t('accountName'), render: (b) => <span className="font-medium text-ui-text">{b.account_name}</span> },
    { key: 'account_type', header: t('accountType'), render: (b) => <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${b.account_type === 'cash' ? 'bg-ui-warning-soft text-ui-warning' : 'bg-ui-info-soft text-ui-info dark:text-ui-info'}`}>{b.account_type === 'cash' ? t('cash') : t('bank')}</span> },
    { key: 'account_number', header: t('accountCode'), render: (b) => <span className="font-mono text-xs">{b.code || '-'}</span> },
    { key: 'opening_balance', header: t('openingBalance'), render: (b) => formatCurrency(b.opening_balance, currency, lang) },
    { key: 'balance', header: t('balance'), render: (b) => <span className="font-semibold text-ui-success dark:text-ui-success">{formatCurrency(b.balance, currency, lang)}</span> },
  ];

  const txColumns: Column<TreasuryTransaction>[] = [
    { key: 'created_at', header: t('date'), render: (tx) => formatDateTime(tx.created_at, lang) },
    { key: 'transaction_type', header: t('referenceType'), render: (tx) => (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${tx.transaction_type === 'deposit' ? 'bg-ui-success-soft text-ui-success dark:text-ui-success' : tx.transaction_type === 'withdrawal' ? 'bg-ui-danger-soft text-ui-danger dark:text-ui-danger' : 'bg-ui-info-soft text-ui-info dark:text-ui-info'}`}>
        {{ transfer: t('transfer'), deposit: t('deposit'), withdrawal: t('withdrawal') }[tx.transaction_type]}
      </span>
    ) },
    { key: 'reference_number', header: t('entryNumber'), render: (tx) => <span className="font-mono text-xs">{tx.reference_number || '-'}</span> },
    { key: 'notes', header: isAr ? 'البيان' : 'Details', render: (tx) => <span className="text-sm text-ui-muted">{tx.notes || '-'}</span> },
    { key: 'from', header: t('fromAccount'), render: (tx) => tx.from_account?.account_name || '-' },
    { key: 'to', header: t('toAccount'), render: (tx) => tx.to_account?.account_name || '-' },
    { key: 'amount', header: t('amount'), render: (tx) => <span className="font-semibold text-ui-text">{formatCurrency(tx.amount, currency, lang)}</span> },
  ];
  const allDailyColumns: Record<DailyColumnKey, Column<TreasuryDailyDisplayRow>> = {
    business_date: { key: 'business_date', header: isAr ? 'التاريخ' : 'Date', render: (row) => <span className="font-bold text-ui-text">{row.business_date}</span> },
    cash_opening_balance: { key: 'cash_opening_balance', header: isAr ? 'نقدي مرحّل' : 'Cash carried', render: (row) => formatCurrency(row.cash_opening_balance, currency, lang) },
    bank_opening_balance: { key: 'bank_opening_balance', header: isAr ? 'بنك مرحّل' : 'Bank carried', render: (row) => formatCurrency(row.bank_opening_balance, currency, lang) },
    cash_sales: { key: 'cash_sales', header: isAr ? 'بيع نقدي' : 'Cash sales', render: (row) => formatCurrency(row.cash_sales, currency, lang) },
    bank_sales: { key: 'bank_sales', header: isAr ? 'بيع بنك/كارت' : 'Bank/Card sales', render: (row) => formatCurrency(row.bank_sales, currency, lang) },
    credit_sales: { key: 'credit_sales', header: isAr ? 'آجل' : 'Credit', render: (row) => formatCurrency(row.credit_sales, currency, lang) },
    cash_purchases: { key: 'cash_purchases', header: isAr ? 'مشتريات' : 'Purchases', render: (row) => formatCurrency(row.cash_purchases, currency, lang) },
    expenses: { key: 'expenses', header: isAr ? 'مصروفات' : 'Expenses', render: (row) => formatCurrency(row.expenses, currency, lang) },
    transfer_in: { key: 'transfer_in', header: isAr ? 'تحويل وارد' : 'Transfer in', render: (row) => formatCurrency(row.transfer_in, currency, lang) },
    transfer_out: { key: 'transfer_out', header: isAr ? 'تحويل صادر' : 'Transfer out', render: (row) => formatCurrency(row.transfer_out, currency, lang) },
    shift_cash_net: { key: 'shift_cash_net', header: isAr ? 'صافي نقدي الشفتات' : 'Shift cash net', render: (row) => <span className="font-semibold text-ui-text">{formatCurrency(row.shift_cash_net, currency, lang)}</span> },
    cash_day_net: { key: 'cash_day_net', header: isAr ? 'صافي نقدي اليوم' : 'Daily cash net', render: (row) => <span className="font-black text-ui-primary">{formatCurrency(row.cash_day_net, currency, lang)}</span> },
    cash_balance_after_close: { key: 'cash_balance_after_close', header: isAr ? 'رصيد نقدي فعلي' : 'Actual cash balance', render: (row) => <span className="font-semibold text-ui-text">{formatCurrency(row.cash_balance_after_close, currency, lang)}</span> },
    bank_balance_after_close: { key: 'bank_balance_after_close', header: isAr ? 'رصيد بنك فعلي' : 'Actual bank balance', render: (row) => <span className="font-semibold text-ui-text">{formatCurrency(row.bank_balance_after_close, currency, lang)}</span> },
    closing_balance: { key: 'closing_balance', header: isAr ? 'إجمالي آخر اليوم' : 'Day closing total', render: (row) => <span className={`font-black ${row.is_latest ? 'text-ui-primary' : 'text-ui-text'}`}>{formatCurrency(row.closing_balance, currency, lang)}</span> },
    report: { key: 'report', header: isAr ? 'اليوم' : 'Day', render: (row) => (
      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="outline" onClick={() => setSelectedDay(row)}>
          {isAr ? 'تفاصيل' : 'Details'}
        </Button>
        <Button size="sm" variant="outline" onClick={() => { void openDayCloseDetail(row); }}>
          <FileText className="h-4 w-4" /> {isAr ? 'تقرير' : 'Report'}
        </Button>
      </div>
    ) },
  };
  const dailyColumns = visibleDailyColumns.map((key) => allDailyColumns[key]);

  const toggleDailyColumn = (key: DailyColumnKey) => {
    setVisibleDailyColumns((current) => {
      if (current.includes(key)) {
        if (key === 'business_date') return current;
        return current.filter((item) => item !== key);
      }
      return dailyColumnOptions.filter((item) => item === key || current.includes(item));
    });
  };

  return (
    <DesignSurface testId="treasury-page">
      <DesignPageHeader
        title={t('treasury')}
        subtitle={t('treasuryTransactions')}
        actions={(can('accounts.manage') || can('accounting.treasury.transfer')) && (
          <div className="flex flex-wrap gap-2">
            {can('accounts.manage') && (
              <>
                <Button size="sm" onClick={() => openModal('deposit')}><PiggyBank className="w-4 h-4" /> {t('deposit')}</Button>
                <Button size="sm" variant="warning" onClick={() => openModal('withdrawal')}><HandCoins className="w-4 h-4" /> {t('withdrawal')}</Button>
              </>
            )}
            {can('accounting.treasury.transfer') && (
              <Button size="sm" variant="outline" onClick={() => openModal('transfer')}><ArrowLeftRight className="w-4 h-4" /> {t('transfer')}</Button>
            )}
          </div>
        )}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard title={isAr ? 'إجمالي خزائن الفرع' : 'Branch treasury total'} value={formatCurrency(totalCash + totalBank, currency, lang)} icon={<Wallet className="w-5 h-5" />} color="brand" />
        <StatCard title={isAr ? 'خزنة الفرع' : 'Branch cash'} value={formatCurrency(totalCash, currency, lang)} icon={<HandCoins className="w-5 h-5" />} color="amber" />
        <StatCard title={t('bank')} value={formatCurrency(totalBank, currency, lang)} icon={<Landmark className="w-5 h-5" />} color="blue" />
        <StatCard title={isAr ? 'الخزنة الرئيسية' : 'Main Treasury'} value={formatCurrency(mainTreasuryBalance, currency, lang)} icon={<PiggyBank className="w-5 h-5" />} color="purple" />
      </div>

      {isAdminRole(user?.role) && branches.length > 0 && (
        <DesignPanel testId="treasury-branch-panel" className="ui-accent-finance">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm font-medium text-ui-muted">{t('filterByBranch')}</label>
            <select value={adminBranchFilter} onChange={(e) => setAdminBranchFilter(e.target.value)}
              className="min-w-0 flex-1 sm:flex-none px-3 py-2 rounded-lg text-sm border border-ui-border bg-ui-surface text-ui-text">
              <option value="" disabled>{t('filterByBranch')}</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{isAr ? b.name : (b.name_en || b.name)}</option>)}
            </select>
          </div>
        </DesignPanel>
      )}

      <DesignPanel testId="treasury-scope-switch-panel" className="ui-accent-finance">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={treasuryView === 'branch' ? 'primary' : 'outline'} onClick={() => setTreasuryView('branch')}>
            <Wallet className="h-4 w-4" /> {isAr ? 'خزنة الفرع' : 'Branch Treasury'}
          </Button>
          <Button size="sm" variant={treasuryView === 'main' ? 'primary' : 'outline'} onClick={() => setTreasuryView('main')}>
            <PiggyBank className="h-4 w-4" /> {isAr ? 'الخزنة الرئيسية' : 'Main Treasury'}
          </Button>
        </div>
      </DesignPanel>

      <DesignPanel title={treasuryView === 'main' ? (isAr ? 'رصيد الخزنة الرئيسية' : 'Main treasury balance') : t('treasuryBalances')} testId="treasury-balances-panel">
        <DataTable columns={balanceColumns} data={displayedBalances} loading={loading} error={txError} emptyMessage={t('noData')} />
      </DesignPanel>

      {treasuryView === 'branch' && (
        <DesignPanel title={isAr ? 'يومية الخزينة' : 'Treasury Daily Journal'} testId="treasury-day-close-reconciliation-panel">
          <div className="mb-3 rounded-lg border border-ui-border bg-ui-page-alt p-3 text-sm text-ui-muted">
            {isAr
              ? 'يومية خزينة متصلة حسب يوم العمل: رصيد نقدي أول اليوم + صافي نقدي اليوم = رصيد نقدي آخر اليوم، ورصيد آخر اليوم يصبح رصيد أول اليوم التالي. صافي الشفتات مستقل ويُستخدم لعهدة الموظف، والعد النقدي لا يدخل في الحساب.'
              : 'Continuous treasury journal: carried cash and bank equal the prior day closing balances, with sales, expenses, purchases, and transfers explaining the actual cash and bank closing balances.'}
          </div>
          <details className="mb-3 rounded-lg border border-ui-border bg-ui-surface p-3">
            <summary className="cursor-pointer font-semibold text-ui-text">{isAr ? 'تحديد الأعمدة' : 'Choose columns'}</summary>
            <div className="mt-3 flex flex-wrap gap-2">
              {dailyColumnOptions.map((key) => (
                <label key={key} className="inline-flex items-center gap-2 rounded-md border border-ui-border px-2 py-1 text-xs text-ui-text">
                  <input
                    type="checkbox"
                    checked={visibleDailyColumns.includes(key)}
                    disabled={key === 'business_date'}
                    onChange={() => toggleDailyColumn(key)}
                  />
                  <span>{String(allDailyColumns[key].header)}</span>
                </label>
              ))}
            </div>
          </details>
          <DataTable columns={dailyColumns} data={dailyRows} loading={loading} error={txError} emptyMessage={t('noData')} />

          {dailyRows.length > 0 && (
            <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
              <div className="rounded-lg border border-ui-border bg-ui-surface p-3"><div className="text-xs text-ui-muted">{isAr ? 'إجمالي بيع نقدي' : 'Cash sales total'}</div><div className="font-bold text-ui-text">{formatCurrency(periodTotals.cash_sales, currency, lang)}</div></div>
              <div className="rounded-lg border border-ui-border bg-ui-surface p-3"><div className="text-xs text-ui-muted">{isAr ? 'إجمالي بيع بنك/كارت' : 'Bank/Card sales total'}</div><div className="font-bold text-ui-text">{formatCurrency(periodTotals.bank_sales, currency, lang)}</div></div>
              <div className="rounded-lg border border-ui-border bg-ui-surface p-3"><div className="text-xs text-ui-muted">{isAr ? 'إجمالي المصروفات' : 'Expenses total'}</div><div className="font-bold text-ui-text">{formatCurrency(periodTotals.expenses, currency, lang)}</div></div>
              <div className="rounded-lg border border-ui-border bg-ui-surface p-3"><div className="text-xs text-ui-muted">{isAr ? 'إجمالي المشتريات' : 'Purchases total'}</div><div className="font-bold text-ui-text">{formatCurrency(periodTotals.cash_purchases, currency, lang)}</div></div>
              <div className="rounded-lg border border-ui-border bg-ui-surface p-3"><div className="text-xs text-ui-muted">{isAr ? 'تحويلات واردة' : 'Transfers in'}</div><div className="font-bold text-ui-text">{formatCurrency(periodTotals.transfer_in, currency, lang)}</div></div>
              <div className="rounded-lg border border-ui-border bg-ui-surface p-3"><div className="text-xs text-ui-muted">{isAr ? 'تحويلات صادرة' : 'Transfers out'}</div><div className="font-bold text-ui-text">{formatCurrency(periodTotals.transfer_out, currency, lang)}</div></div>
            </div>
          )}

          {selectedDay && (
            <div className="mt-4 rounded-xl border border-ui-border bg-ui-page-alt p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs text-ui-muted">{isAr ? 'تفاصيل يوم' : 'Day details'}</div>
                  <div className="text-lg font-black text-ui-text">{selectedDay.business_date}</div>
                </div>
                <Button size="sm" variant="secondary" onClick={() => setSelectedDay(null)}>{isAr ? 'إغلاق التفاصيل' : 'Close details'}</Button>
              </div>
              <div className="grid gap-3 lg:grid-cols-3">
                <div className="rounded-lg border border-ui-border bg-ui-surface p-3">
                  <div className="mb-2 font-bold text-ui-text">{isAr ? 'الأرصدة' : 'Balances'}</div>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between gap-3"><span>{isAr ? 'نقدي مرحّل' : 'Cash carried'}</span><b>{formatCurrency(selectedDay.cash_opening_balance, currency, lang)}</b></div>
                    <div className="flex justify-between gap-3"><span>{isAr ? 'بنك مرحّل' : 'Bank carried'}</span><b>{formatCurrency(selectedDay.bank_opening_balance, currency, lang)}</b></div>
                    <div className="flex justify-between gap-3"><span>{isAr ? 'رصيد نقدي فعلي' : 'Actual cash'}</span><b>{formatCurrency(selectedDay.cash_balance_after_close, currency, lang)}</b></div>
                    <div className="flex justify-between gap-3"><span>{isAr ? 'رصيد بنك فعلي' : 'Actual bank'}</span><b>{formatCurrency(selectedDay.bank_balance_after_close, currency, lang)}</b></div>
                  </div>
                </div>
                <div className="rounded-lg border border-ui-border bg-ui-surface p-3">
                  <div className="mb-2 font-bold text-ui-text">{isAr ? 'البيع والتحصيل' : 'Sales & collection'}</div>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between gap-3"><span>{isAr ? 'بيع نقدي' : 'Cash sales'}</span><b>{formatCurrency(selectedDay.cash_sales, currency, lang)}</b></div>
                    <div className="flex justify-between gap-3"><span>{isAr ? 'بيع بنك/كارت' : 'Bank/Card sales'}</span><b>{formatCurrency(selectedDay.bank_sales, currency, lang)}</b></div>
                    <div className="flex justify-between gap-3"><span>{isAr ? 'آجل' : 'Credit'}</span><b>{formatCurrency(selectedDay.credit_sales, currency, lang)}</b></div>
                  </div>
                </div>
                <div className="rounded-lg border border-ui-border bg-ui-surface p-3">
                  <div className="mb-2 font-bold text-ui-text">{isAr ? 'المنصرف والتحويلات' : 'Outflows & transfers'}</div>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between gap-3"><span>{isAr ? 'مصروفات' : 'Expenses'}</span><b>{formatCurrency(selectedDay.expenses, currency, lang)}</b></div>
                    <div className="flex justify-between gap-3"><span>{isAr ? 'مشتريات' : 'Purchases'}</span><b>{formatCurrency(selectedDay.cash_purchases, currency, lang)}</b></div>
                    <div className="flex justify-between gap-3"><span>{isAr ? 'تحويل وارد' : 'Transfer in'}</span><b>{formatCurrency(selectedDay.transfer_in, currency, lang)}</b></div>
                    <div className="flex justify-between gap-3"><span>{isAr ? 'تحويل صادر' : 'Transfer out'}</span><b>{formatCurrency(selectedDay.transfer_out, currency, lang)}</b></div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </DesignPanel>
      )}

      <DesignPanel title={treasuryView === 'main' ? (isAr ? 'حركة الخزنة الرئيسية' : 'Main Treasury Movements') : (isAr ? 'حركة خزنة الفرع' : 'Branch Treasury Movements')} testId="treasury-transactions-panel">
        <DataTable columns={txColumns} data={transactions} loading={txLoading} error={txError} emptyMessage={t('noData')} />
        <DesignPagination loaded={transactions.length} total={txTotal} hasMore={txHasMore} loadingMore={loadingMoreTx} onLoadMore={loadMoreTx} />
      </DesignPanel>

      <Modal open={modal === 'transfer'} onClose={() => setModal(null)} title={t('transfer')}>
        <div className="space-y-4">
          <Select label={t('fromAccount')} value={form.from_account_id} onChange={(e) => setForm({ ...form, from_account_id: e.target.value })}>
            <option value="">{t('selectAccount')}</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{accountLabel(a)} — {formatCurrency(a.balance, currency, lang)}</option>)}
          </Select>
          <Select label={t('toAccount')} value={form.to_account_id} onChange={(e) => setForm({ ...form, to_account_id: e.target.value })}>
            <option value="">{t('selectAccount')}</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{accountLabel(a)} — {formatCurrency(a.balance, currency, lang)}</option>)}
          </Select>
          <Input label={t('amount')} type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
          <Textarea label={t('notes')} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setModal(null)}>{t('cancel')}</Button>
            <Button onClick={submit} disabled={saving}><ArrowLeftRight className="w-4 h-4" /> {saving ? t('loading') : t('transfer')}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={modal === 'deposit'} onClose={() => setModal(null)} title={t('deposit')}>
        <div className="space-y-4">
          <Select label={t('accountName')} value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })}>
            <option value="">{t('selectAccount')}</option>
            {localAccounts.map((a) => <option key={a.id} value={a.id}>{accountLabel(a)} — {formatCurrency(a.balance, currency, lang)}</option>)}
          </Select>
          <Input label={t('amount')} type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
          <Textarea label={t('notes')} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setModal(null)}>{t('cancel')}</Button>
            <Button onClick={submit} disabled={saving}><PiggyBank className="w-4 h-4" /> {saving ? t('loading') : t('deposit')}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={modal === 'withdrawal'} onClose={() => setModal(null)} title={t('withdrawal')}>
        <div className="space-y-4">
          <Select label={t('accountName')} value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })}>
            <option value="">{t('selectAccount')}</option>
            {localAccounts.map((a) => <option key={a.id} value={a.id}>{accountLabel(a)} — {formatCurrency(a.balance, currency, lang)}</option>)}
          </Select>
          <Input label={t('amount')} type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
          <Textarea label={t('notes')} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setModal(null)}>{t('cancel')}</Button>
            <Button variant="warning" onClick={submit} disabled={saving}><HandCoins className="w-4 h-4" /> {saving ? t('loading') : t('withdrawal')}</Button>
          </div>
        </div>
      </Modal>
    </DesignSurface>
  );
}
