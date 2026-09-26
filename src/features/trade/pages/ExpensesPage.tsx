import { useEffect, useState } from 'react';
import { Download, Pencil, Plus, RotateCcw, SlidersHorizontal } from 'lucide-react';
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

type ExpenseAccountOption = { id: string; code: string; name: string; name_en: string | null };
type TreasuryOption = { id: string; account_name: string; account_type: string };
type ExpenseRoute = {
  id: string;
  category: string;
  expense_account_id: string;
  expense_account_code: string;
  expense_account_name: string;
  treasury_account_id: string;
  treasury_account_name: string;
  treasury_account_type: string;
  payment_method: string;
  is_active: boolean;
};

const emptyForm = (branchId = '') => ({
  category: '',
  description: '',
  amount: 0,
  branch_id: branchId,
  payment_method: 'cash',
  expense_date: todayISO(),
  notes: '',
  expense_account_id: '',
  treasury_account_id: '',
});

export function ExpensesPage() {
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';
  const { user } = useAuth();
  const branchFilter = useBranchFilter();
  const { show } = useToast();
  const can = useCan();
  const history = useHistoryAccess();
  const { rows: items, loading, error, total, hasMore, loadMore, loadingMore, refresh: reloadExpenses, fetchAll: fetchAllExpenses } = usePaginatedRows<Expense>({
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
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [editReason, setEditReason] = useState('');
  const [reverseId, setReverseId] = useState<string | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [expenseAccounts, setExpenseAccounts] = useState<ExpenseAccountOption[]>([]);
  const [treasuryAccounts, setTreasuryAccounts] = useState<TreasuryOption[]>([]);
  const [routes, setRoutes] = useState<ExpenseRoute[]>([]);
  const [activeShiftId, setActiveShiftId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [routingOpen, setRoutingOpen] = useState(false);
  const [routeCategory, setRouteCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [routeForm, setRouteForm] = useState({
    expense_account_id: '',
    treasury_account_id: '',
    payment_method: 'cash',
    is_active: true,
  });

  const effectiveBranchId = branchFilter || user?.branch_id || '';

  const applyRoute = (category: string, current = form) => {
    const route = routes.find((item) => item.category === category && item.is_active);
    return {
      ...current,
      category,
      expense_account_id: route?.expense_account_id || current.expense_account_id,
      treasury_account_id: route?.treasury_account_id || current.treasury_account_id,
      payment_method: route?.payment_method || current.payment_method,
    };
  };

  const selectRouteCategory = (category: string) => {
    setRouteCategory(category);
    const existing = routes.find((item) => item.category === category);
    setRouteForm({
      expense_account_id: existing?.expense_account_id || '',
      treasury_account_id: existing?.treasury_account_id || '',
      payment_method: existing?.payment_method || 'cash',
      is_active: existing?.is_active ?? true,
    });
  };

  useEffect(() => {
    if (!effectiveBranchId) {
      setExpenseAccounts([]);
      setTreasuryAccounts([]);
      setRoutes([]);
      setActiveShiftId(null);
      return;
    }
    let cancelled = false;
    void Promise.all([
      supabase.from('chart_of_accounts').select('id,code,name,name_en').eq('branch_id', effectiveBranchId).eq('account_type', 'expense').eq('is_active', true).order('code'),
      supabase.from('treasury_accounts').select('id,account_name,account_type').eq('branch_id', effectiveBranchId).eq('is_active', true).order('account_type'),
      api.pos.getActiveShift({ p_branch_id: effectiveBranchId }),
      api.accounting.getExpenseRoutingRules({ p_branch_id: effectiveBranchId }),
    ]).then(([accountsRes, treasuryRes, shiftRes, routesRes]) => {
      if (cancelled) return;
      setExpenseAccounts((accountsRes.data || []) as ExpenseAccountOption[]);
      setTreasuryAccounts((treasuryRes.data || []) as TreasuryOption[]);
      setRoutes((routesRes.data || []) as ExpenseRoute[]);
      const active = shiftRes.data as unknown as { open?: boolean; shift?: { id?: string } | null } | null;
      setActiveShiftId(active?.open ? active.shift?.id || null : null);
    });
    return () => { cancelled = true; };
  }, [effectiveBranchId]);

  const filtered = items.filter((e) => {
    if (!search) return true;
    const term = search.toLowerCase();
    const account = expenseAccounts.find((item) => item.id === e.account_id);
    const treasury = treasuryAccounts.find((item) => item.id === e.treasury_account_id);
    const branch = branches.find((item) => item.id === e.branch_id);
    return [
      e.description, e.category, e.payment_method, e.status, e.notes, e.void_reason,
      e.shift_id, e.created_by, account?.code, account?.name, account?.name_en,
      treasury?.account_name, branch?.name,
    ].some((value) => String(value || '').toLowerCase().includes(term));
  });

  const openAdd = () => {
    setEditingExpense(null);
    setEditReason('');
    setForm(emptyForm(effectiveBranchId));
    setModalOpen(true);
  };

  const openEdit = (expense: Expense) => {
    setEditingExpense(expense);
    setEditReason('');
    setForm({
      category: expense.category || '',
      description: expense.description || '',
      amount: Number(expense.amount || 0),
      branch_id: expense.branch_id || effectiveBranchId,
      payment_method: expense.payment_method || 'cash',
      expense_date: expense.expense_date || todayISO(),
      notes: expense.notes || '',
      expense_account_id: expense.account_id || '',
      treasury_account_id: expense.treasury_account_id || '',
    });
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.amount || form.amount <= 0) { show(t('required') + ': ' + t('amount'), 'error'); return; }
    if (!effectiveBranchId || !activeShiftId) { show(isAr ? 'لا توجد وردية مفتوحة' : 'No open shift is available', 'error'); return; }
    if (!form.category) { show(isAr ? 'اختر نوع المصروف' : 'Select an expense category', 'error'); return; }
    if (!form.expense_account_id || !form.treasury_account_id) {
      show(isAr ? 'المصروف غير مربوط بتوجيه محاسبي كامل' : 'Expense accounting routing is incomplete', 'error');
      return;
    }

    if (editingExpense) {
      if (!editReason.trim()) {
        show(isAr ? 'سبب التعديل مطلوب' : 'Edit reason is required', 'error');
        return;
      }
      const { data, error: saveError } = await api.accounting.editShiftExpense({
        p_expense_id: editingExpense.id,
        p_idempotency_key: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
        p_category: form.category,
        p_description: form.description || null,
        p_amount: form.amount,
        p_payment_method: form.payment_method,
        p_expense_account_id: form.expense_account_id,
        p_treasury_account_id: form.treasury_account_id,
        p_expense_date: form.expense_date,
        p_notes: form.notes || null,
        p_reason: editReason.trim(),
      });
      const result = data as { success?: boolean; error?: string; detail?: string } | null;
      if (saveError || !result?.success) {
        const message = result?.error === 'CLOSED_SHIFT_EXPENSE_EDIT_BLOCKED'
          ? (isAr ? 'لا يمكن تعديل مصروف وردية مغلقة؛ استخدم عكس/تسوية موثقة.' : 'Closed-shift expenses require a documented reversal/adjustment.')
          : saveError?.message || result?.detail || result?.error || t('error');
        show(message, 'error');
        return;
      }
    } else {
      const { data, error: saveError } = await api.accounting.postShiftExpense({
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
      if (saveError || !result?.success) { show(saveError?.message || result?.detail || result?.error || t('error'), 'error'); return; }
    }

    show(t('saveSuccess'), 'success');
    setModalOpen(false);
    setEditingExpense(null);
    setEditReason('');
    reloadExpenses();
  };

  const reverse = async () => {
    if (!reverseId || !reverseReason.trim()) return;
    const { data, error: reverseError } = await api.accounting.reverseShiftExpense({ p_expense_id: reverseId, p_reason: reverseReason.trim() });
    const result = data as { success?: boolean; error?: string; detail?: string } | null;
    if (reverseError || !result?.success) show(reverseError?.message || result?.detail || result?.error || t('error'), 'error');
    else show(t('saveSuccess'), 'success');
    setReverseId(null);
    setReverseReason('');
    reloadExpenses();
  };

  const saveRoute = async () => {
    if (!effectiveBranchId || !routeCategory || !routeForm.expense_account_id || !routeForm.treasury_account_id) {
      show(t('required'), 'error');
      return;
    }
    const { data, error: routeError } = await api.accounting.upsertExpenseRoutingRule({
      p_branch_id: effectiveBranchId,
      p_category: routeCategory,
      p_expense_account_id: routeForm.expense_account_id,
      p_treasury_account_id: routeForm.treasury_account_id,
      p_payment_method: routeForm.payment_method,
      p_is_active: routeForm.is_active,
    });
    const result = data as { success?: boolean; error?: string; detail?: string } | null;
    if (routeError || !result?.success) {
      show(routeError?.message || result?.detail || result?.error || t('error'), 'error');
      return;
    }
    const refreshed = await api.accounting.getExpenseRoutingRules({ p_branch_id: effectiveBranchId });
    const nextRoutes = (refreshed.data || []) as ExpenseRoute[];
    setRoutes(nextRoutes);
    const current = nextRoutes.find((item) => item.category === routeCategory);
    if (current) {
      setRouteForm({
        expense_account_id: current.expense_account_id,
        treasury_account_id: current.treasury_account_id,
        payment_method: current.payment_method,
        is_active: current.is_active,
      });
    }
    show(t('saveSuccess'), 'success');
  };

  const handleExport = async () => {
    const all = await fetchAllExpenses();
    const term = search.trim().toLowerCase();
    const exportRows = term
      ? all.filter((e) => [e.category, e.description, e.payment_method].some((value) => String(value || '').toLowerCase().includes(term)))
      : all;
    exportToExcel(exportRows.map((e) => {
      const account = expenseAccounts.find((item) => item.id === e.account_id);
      const treasury = treasuryAccounts.find((item) => item.id === e.treasury_account_id);
      const branch = branches.find((item) => item.id === e.branch_id);
      return {
        Date: e.expense_date,
        CreatedAt: e.created_at,
        Status: e.status || 'posted',
        Category: e.category || '',
        Description: e.description || '',
        Amount: e.amount,
        PaymentMethod: e.payment_method,
        ExpenseAccountCode: account?.code || '',
        ExpenseAccount: account ? (isAr ? account.name : account.name_en || account.name) : '',
        PaymentSource: treasury?.account_name || '',
        Branch: branch?.name || '',
        ShiftId: e.shift_id || '',
        CreatedBy: e.created_by || '',
        Notes: e.notes || '',
        VoidedAt: e.voided_at || '',
        VoidedBy: e.voided_by || '',
        VoidReason: e.void_reason || '',
        ExpenseId: e.id,
      };
    }), 'expenses');
  };

  const columns: Column<Expense>[] = [
    { key: 'expense_date', header: t('date'), render: (e) => formatDate(e.expense_date, lang) },
    { key: 'status', header: isAr ? 'الحالة' : 'Status', render: (e) => (
      <span className={e.status === 'voided' ? 'font-semibold text-ui-danger' : 'font-semibold text-ui-success'}>
        {e.status === 'voided' ? (isAr ? 'معكوس/ملغي' : 'Voided/Reversed') : (isAr ? 'مرحل وفعال' : 'Posted/Active')}
      </span>
    ) },
    { key: 'category', header: t('expenseCategory'), render: (e) => <span className="capitalize">{e.category || '-'}</span> },
    { key: 'description', header: t('description'), render: (e) => e.description || '-' },
    { key: 'amount', header: t('amount'), render: (e) => (
      <span className={`font-semibold ${e.status === 'voided' ? 'line-through text-ui-muted' : 'text-ui-danger'}`}>
        {formatCurrency(e.amount, currency, lang)}
      </span>
    ) },
    { key: 'payment_method', header: t('paymentMethod'), render: (e) => <span className="capitalize">{e.payment_method}</span> },
    { key: 'account_id', header: isAr ? 'حساب المصروف' : 'Expense account', render: (e) => {
      const account = expenseAccounts.find((item) => item.id === e.account_id);
      return account ? `${account.code} - ${isAr ? account.name : account.name_en || account.name}` : (isAr ? 'غير مرتبط/غير ظاهر' : 'Unlinked/unavailable');
    } },
    { key: 'treasury_account_id', header: isAr ? 'مصدر الدفع' : 'Payment source', render: (e) => {
      const source = treasuryAccounts.find((item) => item.id === e.treasury_account_id);
      return source ? `${source.account_name} · ${source.account_type}` : (isAr ? 'غير مرتبط/غير ظاهر' : 'Unlinked/unavailable');
    } },
    { key: 'branch_id', header: isAr ? 'الفرع' : 'Branch', render: (e) => branches.find((item) => item.id === e.branch_id)?.name || e.branch_id || '-' },
    { key: 'shift_id', header: isAr ? 'الوردية' : 'Shift', render: (e) => <span className="font-mono text-xs">{e.shift_id || '-'}</span> },
    { key: 'created_by', header: isAr ? 'أنشأ بواسطة' : 'Created by', render: (e) => <span className="font-mono text-xs">{e.created_by || '-'}</span> },
    { key: 'created_at', header: isAr ? 'وقت الإنشاء' : 'Created at', render: (e) => e.created_at ? formatDate(e.created_at, lang) : '-' },
    { key: 'notes', header: t('notes'), render: (e) => e.notes || '-' },
    { key: 'void_reason', header: isAr ? 'سبب العكس/الإلغاء' : 'Void/reversal reason', render: (e) => e.void_reason || '-' },
    { key: 'actions', header: t('actions'), render: (e) => (
      <div className="flex gap-1">
        {can('expenses.edit') && e.status !== 'voided' && e.shift_id === activeShiftId && (
          <button onClick={() => openEdit(e)} className="p-1.5 rounded-md hover:bg-ui-page-alt text-ui-primary" title={isAr ? 'تعديل المصروف' : 'Edit expense'}><Pencil className="w-4 h-4" /></button>
        )}
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
          {can('expenses.routing.manage') && (
            <Button variant="outline" size="sm" onClick={() => { selectRouteCategory(routeCategory); setRoutingOpen(true); }}>
              <SlidersHorizontal className="w-4 h-4" /> {isAr ? 'توجيهات المصروفات' : 'Expense routing'}
            </Button>
          )}
          {can('expenses.manage') && (
            <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4" /> {t('add')}</Button>
          )}
        </>
      } />
      <DesignPanel testId="expenses-search-panel">
        <DesignSearch value={search} onChange={setSearch} label={t('search')} placeholder={t('search')} testId="expenses-search" />
      </DesignPanel>
      <DesignPanel testId="expenses-table-panel">
        <div className="mb-3 rounded-lg border border-ui-border bg-ui-page-alt p-3 text-sm text-ui-text">
          {isAr
            ? 'كل سجلات المصروفات ظاهرة هنا، بما فيها السجلات المعكوسة/الملغاة. السجل المعكوس يظهر مشطوبًا وحالته وسبب العكس واضحان؛ التقارير المالية الفعالة تعتمد السجلات المرحلة فقط.'
            : 'All expense records are shown, including reversed/voided rows. Reversed rows are struck through with status and reason visible; active financial reporting uses posted records only.'}
        </div>
        <DataTable columns={columns} data={filtered} loading={loading} error={error} emptyMessage={t('noData')} />
        <DesignPagination loaded={items.length} total={total} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} />
      </DesignPanel>

      <Modal open={modalOpen} onClose={() => { setModalOpen(false); setEditingExpense(null); }} title={editingExpense ? (isAr ? 'تعديل المصروف' : 'Edit expense') : t('add')}>
        <div className="space-y-4">
          {editingExpense && (
            <div className="rounded-lg border border-ui-border bg-ui-page-alt p-3 text-sm text-ui-muted">
              {isAr
                ? 'سيتم عكس أثر المصروف القديم وإنشاء مصروف بديل داخل نفس العملية، للحفاظ على تطابق الخزينة والقيود والتقارير.'
                : 'The old posting will be reversed and replaced atomically so treasury, journal and reports remain aligned.'}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <Select
              label={t('expenseCategory')}
              value={form.category}
              onChange={(e) => setForm(applyRoute(e.target.value, { ...form }))}
            >
              <option value="">--</option>
              {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c} className="capitalize">{c}</option>)}
            </Select>
            <Input label={t('expenseDate')} type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} required />
            <Input label={t('amount')} type="number" step="0.01" value={form.amount || ''} onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })} required />
            <Select label={isAr ? 'حساب المصروف' : 'Expense account'} value={form.expense_account_id} onChange={(e) => setForm({ ...form, expense_account_id: e.target.value })} required>
              <option value="">--</option>
              {expenseAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} - {isAr ? account.name : account.name_en || account.name}</option>)}
            </Select>
            <Select label={isAr ? 'مصدر الدفع' : 'Payment source'} value={form.treasury_account_id} onChange={(e) => setForm({ ...form, treasury_account_id: e.target.value })} required>
              <option value="">--</option>
              {treasuryAccounts.map((account) => <option key={account.id} value={account.id}>{account.account_name} ({account.account_type})</option>)}
            </Select>
            <Select label={t('paymentMethod')} value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })}>
              <option value="cash">{t('cash')}</option>
              <option value="card">{t('card')}</option>
              <option value="transfer">{t('transfer')}</option>
            </Select>
            {!branchFilter && !editingExpense && (
              <Select label={t('branch')} value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}>
                <option value="">--</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            )}
          </div>
          {form.category && !routes.some((route) => route.category === form.category && route.is_active) && (
            <div className="rounded-lg border border-ui-warning/30 bg-ui-warning-soft p-3 text-sm text-ui-text">
              {isAr ? 'لا يوجد توجيه محفوظ لهذا النوع. يمكن الحفظ بعد تحديد حساب المصروف ومصدر الدفع.' : 'No saved route exists for this category. Select the expense account and payment source before saving.'}
            </div>
          )}
          <Input label={t('description')} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <Textarea label={t('notes')} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          {editingExpense && (
            <Textarea label={isAr ? 'سبب التعديل' : 'Edit reason'} value={editReason} onChange={(e) => setEditReason(e.target.value)} rows={2} required />
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setModalOpen(false); setEditingExpense(null); }}>{t('cancel')}</Button>
            <Button onClick={save}>{t('save')}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={routingOpen} onClose={() => setRoutingOpen(false)} title={isAr ? 'توجيهات المصروفات المحاسبية' : 'Expense accounting routing'}>
        <div className="space-y-4">
          <div className="rounded-lg border border-ui-border bg-ui-page-alt p-3 text-sm text-ui-muted">
            {isAr
              ? 'حدد الحساب ومصدر الدفع الافتراضي لكل نوع مصروف. لا يتم تعديل أي مصروفات سابقة عند تغيير التوجيه.'
              : 'Set the default account and payment source for each expense category. Existing expenses are never rewritten.'}
          </div>
          <Select label={t('expenseCategory')} value={routeCategory} onChange={(e) => selectRouteCategory(e.target.value)}>
            {EXPENSE_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
          </Select>
          <Select label={isAr ? 'حساب المصروف في شجرة الحسابات' : 'Expense account in chart of accounts'} value={routeForm.expense_account_id} onChange={(e) => setRouteForm({ ...routeForm, expense_account_id: e.target.value })}>
            <option value="">--</option>
            {expenseAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} - {isAr ? account.name : account.name_en || account.name}</option>)}
          </Select>
          <Select label={isAr ? 'مصدر الدفع الافتراضي' : 'Default payment source'} value={routeForm.treasury_account_id} onChange={(e) => setRouteForm({ ...routeForm, treasury_account_id: e.target.value })}>
            <option value="">--</option>
            {treasuryAccounts.map((account) => <option key={account.id} value={account.id}>{account.account_name} ({account.account_type})</option>)}
          </Select>
          <Select label={t('paymentMethod')} value={routeForm.payment_method} onChange={(e) => setRouteForm({ ...routeForm, payment_method: e.target.value })}>
            <option value="cash">{t('cash')}</option>
            <option value="card">{t('card')}</option>
            <option value="transfer">{t('transfer')}</option>
          </Select>
          <label className="flex items-center gap-2 text-sm text-ui-text">
            <input type="checkbox" checked={routeForm.is_active} onChange={(e) => setRouteForm({ ...routeForm, is_active: e.target.checked })} />
            {isAr ? 'التوجيه نشط' : 'Routing is active'}
          </label>
          <div className="rounded-lg border border-ui-border divide-y divide-ui-border">
            {EXPENSE_CATEGORIES.map((category) => {
              const route = routes.find((item) => item.category === category);
              return (
                <div key={category} className="grid grid-cols-[1fr_2fr] gap-3 p-2 text-xs">
                  <span className="font-semibold">{category}</span>
                  <span className="text-ui-muted">
                    {route
                      ? `${route.expense_account_code} - ${route.expense_account_name} → ${route.treasury_account_name}${route.is_active ? '' : isAr ? ' (متوقف)' : ' (inactive)'}`
                      : (isAr ? 'غير موجه' : 'Not configured')}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRoutingOpen(false)}>{t('cancel')}</Button>
            <Button onClick={saveRoute}>{t('save')}</Button>
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
