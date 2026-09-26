import { useEffect, useState, useCallback } from 'react';
import { Landmark, ArrowLeftRight, PiggyBank, HandCoins, Wallet, FileText, Eye } from 'lucide-react';
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
  const [movementDetail, setMovementDetail] = useState<TreasuryMovementRow | null>(null);

  useEffect(() => {
    if (!isAdminRole(user?.role) || adminBranchFilter || branches.length === 0) return;
    const preferred = user?.branch_id && branches.some((b) => b.id === user.branch_id)
      ? user.branch_id
      : branches[0].id;
    setAdminBranchFilter(preferred);
  }, [user?.role, user?.branch_id, branches, adminBranchFilter]);

  const effectiveBranchFilter = isAdminRole(user?.role) ? (adminBranchFilter || null) : branchFilter;
  const currency = effectiveSettings(effectiveBranchFilter)?.currency || 'EGP';
  const transactionBranchScope = effectiveBranchFilter
    ? `branch_id.eq.${effectiveBranchFilter},from_branch_id.eq.${effectiveBranchFilter},to_branch_id.eq.${effectiveBranchFilter}`
    : undefined;
  const { rows: transactions, loading: txLoading, error: txError, total: txTotal, hasMore: txHasMore, loadMore: loadMoreTx, loadingMore: loadingMoreTx, refresh: reloadTx } = usePaginatedRows<TreasuryTransaction>({
    table: 'treasury_transactions',
    select: '*, from_account:treasury_accounts!from_account_id(account_name,branch_id,scope,kind), to_account:treasury_accounts!to_account_id(account_name,branch_id,scope,kind)',
    order: { column: 'created_at', ascending: false },
    or: transactionBranchScope,
    min: history.minIso ? { column: 'created_at', value: history.minIso } : undefined,
    pageSize: 100,
    enabled: !!effectiveBranchFilter,
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

  const movementLabel = (referenceType: string) => {
    const labels: Record<string, { ar: string; en: string }> = {
      sale: { ar: 'مبيعات', en: 'Sale' },
      expense: { ar: 'مصروف', en: 'Expense' },
      expense_reversal: { ar: 'عكس مصروف', en: 'Expense reversal' },
      purchase: { ar: 'شراء', en: 'Purchase' },
      purchase_return: { ar: 'مرتجع شراء', en: 'Purchase return' },
      purchase_payment_reconciliation: { ar: 'تسوية شراء', en: 'Purchase reconciliation' },
      refund: { ar: 'مرتجع مبيعات', en: 'Refund' },
      treasury_transfer: { ar: 'تحويل خزنة', en: 'Treasury transfer' },
      treasury_deposit: { ar: 'إيداع خزنة', en: 'Treasury deposit' },
      treasury_withdrawal: { ar: 'سحب خزنة', en: 'Treasury withdrawal' },
    };
    const item = labels[referenceType];
    return item ? (isAr ? item.ar : item.en) : referenceType;
  };

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

  const signedCurrency = (value: number) => {
    const numeric = Number(value || 0);
    const sign = numeric > 0 ? '+' : '';
    return `${sign}${formatCurrency(numeric, currency, lang)}`;
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

  const visibleBalances = balances.filter(
    (b) => b.scope === 'organization' || b.branch_id === effectiveBranchFilter,
  );
  const localAccounts = accounts.filter(
    (a) => a.scope === 'branch' && a.branch_id === effectiveBranchFilter,
  );
  const totalCash = localAccounts.filter((b) => b.account_type === 'cash').reduce((s, b) => s + Number(b.balance), 0);
  const totalBank = localAccounts.filter((b) => b.account_type === 'bank').reduce((s, b) => s + Number(b.balance), 0);
  const mainTreasury = balances.find((b) => b.scope === 'organization' && b.kind === 'main_cash');
  const mainTreasuryBalance = Number(mainTreasury?.balance || 0);
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
    { key: 'from', header: t('fromAccount'), render: (tx) => tx.from_account?.account_name || '-' },
    { key: 'to', header: t('toAccount'), render: (tx) => tx.to_account?.account_name || '-' },
    { key: 'amount', header: t('amount'), render: (tx) => <span className="font-semibold text-ui-text">{formatCurrency(tx.amount, currency, lang)}</span> },
  ];

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

      <DesignPanel title={t('treasuryBalances')} testId="treasury-balances-panel">
        <DataTable columns={balanceColumns} data={visibleBalances} loading={loading} error={txError} emptyMessage={t('noData')} />
      </DesignPanel>

      <DesignPanel title={isAr ? 'مطابقة إغلاقات الأيام مع خزنة الفرع' : 'Day-close reconciliation with branch treasury'} testId="treasury-day-close-reconciliation-panel">
        <div className="mb-3 rounded-lg border border-ui-border bg-ui-page-alt p-3 text-sm text-ui-muted">
          {isAr
            ? 'كل يوم يعرض رصيد لحظة الإغلاق، ثم الحركات التي أثرت على الخزنة بعده حتى الإغلاق التالي. آخر يوم ينتهي عند الرصيد الحالي الفعلي للخزنة.'
            : 'Each day shows the balance at close, then every treasury-impacting movement until the next close. The latest day ends at the actual current treasury balance.'}
        </div>

        {loading ? (
          <div className="py-8 text-center text-sm text-ui-muted">{t('loading')}</div>
        ) : dayCloses.length === 0 ? (
          <div className="py-8 text-center text-sm text-ui-muted">{t('noData')}</div>
        ) : (
          <div className="space-y-4">
            {dayCloses.map((row) => (
              <div key={row.daily_close_id} className="overflow-hidden rounded-xl border border-ui-border bg-ui-surface">
                <div className="flex flex-col gap-3 border-b border-ui-border bg-ui-page-alt p-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-black text-ui-text">{isAr ? 'إغلاق يوم' : 'Day close'} {row.business_date}</span>
                      {row.is_latest && <span className="rounded-full bg-ui-primary-soft px-2 py-0.5 text-xs font-bold text-ui-primary">{isAr ? 'آخر إغلاق' : 'Latest close'}</span>}
                    </div>
                    <div className="mt-1 text-xs text-ui-muted">{formatDateTime(row.closed_at, lang)}</div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => { void openDayCloseDetail(row); }}>
                    <FileText className="h-4 w-4" /> {isAr ? 'تقرير إغلاق اليوم' : 'Day Closing Report'}
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-px bg-ui-border sm:grid-cols-3 lg:grid-cols-6">
                  {[
                    [isAr ? 'مبيعات الكاش' : 'Cash sales', row.cash_sales],
                    [isAr ? 'مبيعات البنك/الكارت' : 'Bank/card sales', row.bank_sales],
                    [isAr ? 'مبيعات الأجل' : 'Credit sales', row.credit_sales],
                    [isAr ? 'المصروفات' : 'Expenses', -Math.abs(row.expenses)],
                    [isAr ? 'مشتريات الكاش' : 'Cash purchases', -Math.abs(row.cash_purchases)],
                    [isAr ? 'إجمالي الخزنة عند الإغلاق' : 'Treasury at close', row.total_balance_after_close],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="bg-ui-surface p-3">
                      <div className="text-[11px] font-semibold text-ui-muted">{label}</div>
                      <div className="mt-1 text-sm font-black text-ui-text">{formatCurrency(Number(value), currency, lang)}</div>
                    </div>
                  ))}
                </div>

                <div className="border-t border-ui-border">
                  <div className="flex flex-col gap-2 bg-ui-page-alt px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-sm font-black text-ui-text">{isAr ? 'الحركة بعد الإغلاق' : 'Movement after close'}</div>
                    <div className="flex flex-wrap gap-3 text-xs font-semibold">
                      <span>{isAr ? 'كاش:' : 'Cash:'} {signedCurrency(row.cash_movement_after_close)}</span>
                      <span>{isAr ? 'بنك:' : 'Bank:'} {signedCurrency(row.bank_movement_after_close)}</span>
                      <span>{isAr ? 'الإجمالي:' : 'Total:'} {signedCurrency(row.total_movement_after_close)}</span>
                    </div>
                  </div>

                  {row.movement_details.length === 0 ? (
                    <div className="px-3 py-4 text-sm text-ui-muted">{isAr ? 'لا توجد حركة أثرت على الرصيد بعد هذا الإغلاق.' : 'No balance-impacting movement after this close.'}</div>
                  ) : (
                    <div className="divide-y divide-ui-border">
                      {row.movement_details.map((movement) => (
                        <div key={movement.journal_entry_id} className="grid gap-2 px-3 py-2 text-sm lg:grid-cols-[150px_minmax(180px,1fr)_120px_120px_120px_auto] lg:items-center">
                          <div>
                            <div className="font-bold text-ui-text">{movementLabel(movement.reference_type)}</div>
                            <div className="text-[11px] text-ui-muted">{formatDateTime(movement.created_at, lang)}</div>
                          </div>
                          <div className="min-w-0">
                            <div className="truncate font-mono text-xs text-ui-text">{movement.reference_number || movement.reference_id || '-'}</div>
                            <div className="truncate text-xs text-ui-muted">{movement.description || '-'}</div>
                          </div>
                          <div><span className="text-xs text-ui-muted">{isAr ? 'كاش' : 'Cash'} </span><strong>{signedCurrency(movement.cash_effect)}</strong></div>
                          <div><span className="text-xs text-ui-muted">{isAr ? 'بنك' : 'Bank'} </span><strong>{signedCurrency(movement.bank_effect)}</strong></div>
                          <div><span className="text-xs text-ui-muted">{isAr ? 'الصافي' : 'Net'} </span><strong>{signedCurrency(movement.total_effect)}</strong></div>
                          <Button size="sm" variant="ghost" onClick={() => setMovementDetail(movement)}>
                            <Eye className="h-4 w-4" /> {isAr ? 'توضيح' : 'Details'}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-px border-t border-ui-border bg-ui-border sm:grid-cols-3">
                  <div className="bg-ui-surface p-3"><div className="text-xs text-ui-muted">{isAr ? 'رصيد الكاش بعد الحركة' : 'Cash after movement'}</div><div className="mt-1 font-black">{formatCurrency(row.cash_balance_after_movement, currency, lang)}</div></div>
                  <div className="bg-ui-surface p-3"><div className="text-xs text-ui-muted">{isAr ? 'رصيد البنك بعد الحركة' : 'Bank after movement'}</div><div className="mt-1 font-black">{formatCurrency(row.bank_balance_after_movement, currency, lang)}</div></div>
                  <div className="bg-ui-surface p-3"><div className="text-xs font-bold text-ui-muted">{row.is_latest ? (isAr ? 'الرصيد الحالي للخزنة' : 'Current treasury balance') : (isAr ? 'الرصيد قبل الإغلاق التالي' : 'Balance before next close')}</div><div className="mt-1 text-base font-black text-ui-primary">{formatCurrency(row.total_balance_after_movement, currency, lang)}</div></div>
                </div>
              </div>
            ))}
          </div>
        )}
      </DesignPanel>

      <DesignPanel title={t('treasuryTransactions')} testId="treasury-transactions-panel">
        <DataTable columns={txColumns} data={transactions} loading={txLoading} error={txError} emptyMessage={t('noData')} />
        <DesignPagination loaded={transactions.length} total={txTotal} hasMore={txHasMore} loadingMore={loadingMoreTx} onLoadMore={loadMoreTx} />
      </DesignPanel>

      <Modal open={!!movementDetail} onClose={() => setMovementDetail(null)} title={movementDetail ? movementLabel(movementDetail.reference_type) : ''}>
        {movementDetail && (
          <div className="space-y-3 text-sm">
            <div className="rounded-lg bg-ui-page-alt p-3"><span className="text-ui-muted">{isAr ? 'الوقت:' : 'Time:'}</span> <strong>{formatDateTime(movementDetail.created_at, lang)}</strong></div>
            <div className="rounded-lg bg-ui-page-alt p-3"><span className="text-ui-muted">{isAr ? 'المرجع:' : 'Reference:'}</span> <strong className="font-mono">{movementDetail.reference_number || movementDetail.reference_id || '-'}</strong></div>
            <div className="rounded-lg bg-ui-page-alt p-3"><span className="text-ui-muted">{isAr ? 'الوصف:' : 'Description:'}</span> <strong>{movementDetail.description || '-'}</strong></div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border border-ui-border p-3"><div className="text-xs text-ui-muted">{isAr ? 'أثر الكاش' : 'Cash effect'}</div><div className="mt-1 font-black">{signedCurrency(movementDetail.cash_effect)}</div></div>
              <div className="rounded-lg border border-ui-border p-3"><div className="text-xs text-ui-muted">{isAr ? 'أثر البنك' : 'Bank effect'}</div><div className="mt-1 font-black">{signedCurrency(movementDetail.bank_effect)}</div></div>
              <div className="rounded-lg border border-ui-border p-3"><div className="text-xs text-ui-muted">{isAr ? 'الأثر الصافي' : 'Net effect'}</div><div className="mt-1 font-black">{signedCurrency(movementDetail.total_effect)}</div></div>
            </div>
          </div>
        )}
      </Modal>

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
