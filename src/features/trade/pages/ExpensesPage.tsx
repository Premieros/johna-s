import { useEffect, useState } from 'react';
import { Plus, RotateCcw, Download } from 'lucide-react';
import { supabase } from '@/api';
import * as api from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useToast } from '@/components/Toast';
import { useCan } from '@/lib/permissions';
import { useHistoryAccess } from '@/lib/useHistoryAccess';
import { DesignSurface, DesignPageHeader, DesignSearch, DesignPanel, DesignPagination } from '@/components/design';
import { DataTable, type Column } from '@/components/DataTable';
import { Button } from '@/components/Button';
import { Input, Select, Textarea } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { formatCurrency, formatDate, todayISO } from '@/lib/format';
import { exportToExcel } from '@/lib/excel';
import { useSettings } from '@/context/SettingsContext';
import { useBranches } from '@/hooks/useBranches';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import type { Expense } from '@/lib/types';

const EXPENSE_CATEGORIES = ['rent', 'utilities', 'salaries', 'supplies', 'maintenance', 'marketing', 'transport', 'other'];

export function ExpensesPage() {
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';
  const { user } = useAuth();
  const branchFilter = useBranchFilter();
  const { show } = useToast();
  const can = useCan();
  const history = useHistoryAccess();
  const { rows: items, loading, error, total, hasMore, loadMore, loadingMore, refresh: reloadExpenses } = usePaginatedRows<Expense>({
    table: 'expenses',
    order: { column: 'expense_date', ascending: false },
    branch_id: branchFilter,
    min: history.minDate ? { column: 'expense_date', value: history.minDate } : undefined,
    pageSize: 100,
  });
  const { effectiveSettings } = useSettings();
  const { branches } = useBranches();
  const currency = effectiveSettings(branchFilter)?.currency || 'EGP';
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [reverseId, setReverseId] = useState<string | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [expenseAccounts, setExpenseAccounts] = useState<Array<{ id: string; code: string; name: string; name_en: string | null }>>([]);
  const [treasuryAccounts, setTreasuryAccounts] = useState<Array<{ id: string; account_name: string; account_type: string }>>([]);
  const [activeShiftId, setActiveShiftId] = useState<string | null>(null);
  const [form, setForm] = useState({ category: '', description: '', amount: 0, branch_id: '', payment_method: 'cash', expense_date: todayISO(), notes: '', expense_account_id: '', treasury_account_id: '' });

  const effectiveBranchId = branchFilter || user?.branch_id || '';

  useEffect(() => {
    if (!effectiveBranchId) {
      setExpenseAccounts([]);
      setTreasuryAccounts([]);
      setActiveShiftId(null);
      return;
    }
    let cancelled = false;
    void Promise.all([
      supabase.from('chart_of_accounts').select('id,code,name,name_en').eq('branch_id', effectiveBranchId).eq('account_type', 'expense').eq('is_active', true).order('code'),
      supabase.from('treasury_accounts').select('id,account_name,account_type').eq('branch_id', effectiveBranchId).eq('is_active', true).order('account_type'),
      api.pos.getActiveShift({ p_branch_id: effectiveBranchId }),
    ]).then(([accountsRes, treasuryRes, shiftRes]) => {
      if (cancelled) return;
      setExpenseAccounts((accountsRes.data || []) as typeof expenseAccounts);
      setTreasuryAccounts((treasuryRes.data || []) as typeof treasuryAccounts);
      const active = shiftRes.data as unknown as { open?: boolean; shift?: { id?: string } | null } | null;
      setActiveShiftId(active?.open ? active.shift?.id || null : null);
    });
    return () => { cancelled = true; };
  }, [effectiveBranchId]);

  const filtered = items.filter((e) => !search || e.description?.toLowerCase().includes(search.toLowerCase()) || e.category?.toLowerCase().includes(search.toLowerCase()));
  const openAdd = () => {
    setForm({ category: '', description: '', amount: 0, branch_id: effectiveBranchId, payment_method: 'cash', expense_date: todayISO(), notes: '', expense_account_id: '', treasury_account_id: '' });
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.amount || form.amount <= 0) { show(t('required') + ': ' + t('amount'), 'error'); return; }
    if (!effectiveBranchId || !activeShiftId) { show(isAr ? 'لا توجد وردية مفتوحة' : 'No open shift is available', 'error'); return; }
    if (!form.expense_account_id || !form.treasury_account_id) { show(t('required'), 'error'); return; }
    const { data, error } = await api.accounting.postShiftExpense({
      p_idempotency_key: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      p_branch_id: effectiveBranchId,
      p_shift_id: activeShiftId,
      p_category: form.category,
      p_description: form.description || null,
      p_amount: form.amount,
      p_payment_method: form.payment_method,
      p_expense_account_id: form.expense_account_id,
      p_treasury_account_id: form.treasury_account_id,
      p_expense_date: form.expense_date,
      p_notes: form.notes || null,
    });
    const result = data as { success?: boolean; error?: string; detail?: string } | null;
    if (error || !result?.success) { show(error?.message || result?.detail || result?.error || t('error'), 'error'); return; }
    show(t('saveSuccess'), 'success');
    setModalOpen(false);
    reloadExpenses();
  };

  const reverse = async () => {
    if (!reverseId || !reverseReason.trim()) return;
    const { data, error } = await api.accounting.reverseShiftExpense({ p_expense_id: reverseId, p_reason: reverseReason.trim() });
    const result = data as { success?: boolean; error?: string; detail?: string } | null;
    if (error || !result?.success) show(error?.message || result?.detail || result?.error || t('error'), 'error');
    else show(t('saveSuccess'), 'success');
    setReverseId(null);
    setReverseReason('');
    reloadExpenses();
  };

  const handleExport = () => exportToExcel(items.map((e) => ({ Date: e.expense_date, Category: e.category || '', Description: e.description || '', Amount: e.amount, PaymentMethod: e.payment_method })), 'expenses');

  const columns: Column<Expense>[] = [
    { key: 'expense_date', header: t('date'), render: (e) => formatDate(e.expense_date, lang) },
    { key: 'category', header: t('expenseCategory'), render: (e) => <span className="capitalize">{e.category || '-'}</span> },
    { key: 'description', header: t('description'), render: (e) => e.description || '-' },
    { key: 'amount', header: t('amount'), render: (e) => <span className="font-semibold text-ui-danger">{formatCurrency(e.amount, currency, lang)}</span> },
    { key: 'payment_method', header: t('paymentMethod'), render: (e) => <span className="capitalize">{e.payment_method}</span> },
    { key: 'actions', header: t('actions'), render: (e) => (
      <div className="flex gap-1">
        {can('expenses.manage') && e.status !== 'voided' && (
          <button onClick={() => setReverseId(e.id)} className="p-1.5 rounded-md hover:bg-ui-danger-soft text-ui-danger" title={isAr ? 'عكس المصروف' : 'Reverse expense'}><RotateCcw className="w-4 h-4" /></button>
        )}
      </div>
    )},
  ];

  return (
    <DesignSurface testId="expenses-page">
      <DesignPageHeader title={t('expenses')} actions={
        <>
          <Button variant="outline" size="sm" onClick={handleExport}><Download className="w-4 h-4" /> {t('exportExcel')}</Button>
          {can('expenses.manage') && (
            <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4" /> {t('add')}</Button>
          )}
        </>
      } />
      <DesignPanel testId="expenses-search-panel">
        <DesignSearch value={search} onChange={setSearch} label={t('search')} placeholder={t('search')} testId="expenses-search" />
      </DesignPanel>
      <DesignPanel testId="expenses-table-panel">
        <DataTable columns={columns} data={filtered} loading={loading} error={error} emptyMessage={t('noData')} />
        <DesignPagination loaded={items.length} total={total} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} />
      </DesignPanel>
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={t('add')}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Select label={t('expenseCategory')} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="">--</option>
              {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c} className="capitalize">{c}</option>)}
            </Select>
            <Input label={t('expenseDate')} type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} required />
            <Input label={t('amount')} type="number" step="0.01" value={form.amount || ''} onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })} required />
            <Select label={isAr ? 'حساب المصروف' : 'Expense account'} value={form.expense_account_id} onChange={(e) => setForm({ ...form, expense_account_id: e.target.value })} required>
              <option value="">--</option>
              {expenseAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} - {isAr ? account.name : account.name_en || account.name}</option>)}
            </Select>
            <Select label={isAr ? 'الخزينة / البنك' : 'Treasury / bank'} value={form.treasury_account_id} onChange={(e) => setForm({ ...form, treasury_account_id: e.target.value })} required>
              <option value="">--</option>
              {treasuryAccounts.map((account) => <option key={account.id} value={account.id}>{account.account_name} ({account.account_type})</option>)}
            </Select>
            <Select label={t('paymentMethod')} value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })}>
              <option value="cash">{t('cash')}</option>
              <option value="card">{t('card')}</option>
              <option value="transfer">{t('transfer')}</option>
            </Select>
            {!branchFilter && (
              <Select label={t('branch')} value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}>
                <option value="">--</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            )}
          </div>
          <Input label={t('description')} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <Textarea label={t('notes')} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>{t('cancel')}</Button>
            <Button onClick={save}>{t('save')}</Button>
          </div>
        </div>
      </Modal>
      <Modal open={!!reverseId} onClose={() => setReverseId(null)} title={isAr ? 'عكس المصروف' : 'Reverse expense'}>
        <div className="space-y-4">
          <Textarea label={isAr ? 'سبب العكس' : 'Reversal reason'} value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} rows={3} required />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setReverseId(null)}>{t('cancel')}</Button>
            <Button variant="danger" onClick={reverse} disabled={!reverseReason.trim()}><RotateCcw className="w-4 h-4" /> {isAr ? 'عكس' : 'Reverse'}</Button>
          </div>
        </div>
      </Modal>
    </DesignSurface>
  );
}
