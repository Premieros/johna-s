import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, HandCoins, Plus, UserRound } from 'lucide-react';
import { Button } from '@/components/Button';
import { DataTable, type Column } from '@/components/DataTable';
import { DesignPageHeader, DesignSurface } from '@/components/design/DesignSurface';
import { DesignPanel } from '@/components/design/DesignPanel';
import { DesignSearch } from '@/components/design/DesignSearch';
import { Input, Select, Textarea } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { useLanguage } from '@/context/LanguageContext';
import { useSettings } from '@/context/SettingsContext';
import { useBranches } from '@/hooks/useBranches';
import { formatCurrency } from '@/lib/format';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useCan } from '@/lib/permissions';
import { useHistoryAccess } from '@/lib/useHistoryAccess';
import { EmployeeReceivableDetailPage } from './EmployeeReceivableDetailPage';
import {
  createCurrentMonthEmployeeReceivablePeriod,
  getCairoToday,
  getEmployeeReceivableMinimumDate,
  isValidEmployeeReceivablePeriod,
  type EmployeeReceivablePeriod,
} from '../services/employeeReceivablePeriod';
import {
  createEmployeeCustomer,
  loadEmployeeReceivableRows,
  receiveEmployeeReceivablePayment,
  type EmployeeReceivableRow,
} from '../services/employeeReceivables';

const OPENING_DATE = '2026-09-16';
const emptyForm = { name: '', name_en: '', phone: '', email: '', address: '', notes: '', branch_id: '' };

export function EmployeeReceivablesPage() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const can = useCan();
  const history = useHistoryAccess();
  const branchFilter = useBranchFilter();
  const { branches } = useBranches();
  const { effectiveSettings } = useSettings();
  const { show } = useToast();
  const [selectedBranchId, setSelectedBranchId] = useState(branchFilter || '');
  const effectiveBranchId = branchFilter || selectedBranchId;
  const currency = effectiveSettings(effectiveBranchId || null)?.currency || 'EGP';
  const today = useMemo(() => getCairoToday(), []);
  const minimumPeriodDate = useMemo(
    () => getEmployeeReceivableMinimumDate(today, OPENING_DATE, history.unlimited),
    [today, history.unlimited],
  );
  const initialPeriod = useMemo(
    () => createCurrentMonthEmployeeReceivablePeriod(today, minimumPeriodDate),
    [today, minimumPeriodDate],
  );
  const [period, setPeriod] = useState<EmployeeReceivablePeriod>(initialPeriod);
  const [draftPeriod, setDraftPeriod] = useState<EmployeeReceivablePeriod>(initialPeriod);
  const [rows, setRows] = useState<EmployeeReceivableRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [employeeModalOpen, setEmployeeModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [settling, setSettling] = useState<EmployeeReceivableRow | null>(null);
  const [settleForm, setSettleForm] = useState({ amount: '', payment_method: 'cash', notes: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (branchFilter) setSelectedBranchId(branchFilter);
  }, [branchFilter]);

  const load = useCallback(async () => {
    if (!effectiveBranchId || !can('accounts.view')) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      setRows(await loadEmployeeReceivableRows(effectiveBranchId, period));
    } catch (error) {
      show(error instanceof Error ? error.message : String(error), 'error');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [effectiveBranchId, can, show, period.from, period.to]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => row.name.toLowerCase().includes(q) || row.phone?.includes(q) || row.email?.toLowerCase().includes(q));
  }, [rows, search]);

  // Totals cover every employee in the selected branch, independent of the name filter.
  const totals = useMemo(() => rows.reduce((sum, row) => ({
    opening: sum.opening + row.period_opening_balance,
    debit: sum.debit + row.period_debit,
    credit: sum.credit + row.period_credit,
    closing: sum.closing + row.period_closing_balance,
    current: sum.current + row.open_amount,
  }), { opening: 0, debit: 0, credit: 0, closing: 0, current: 0 }), [rows]);

  const periodIsValid = isValidEmployeeReceivablePeriod(draftPeriod, minimumPeriodDate, today);
  const applyPeriod = () => {
    if (!periodIsValid) {
      show(ar ? 'تحقق من تاريخ البداية والنهاية ضمن الفترة المتاحة' : 'Check the start and end dates within the available period', 'error');
      return;
    }
    setPeriod(draftPeriod);
  };
  const applyCurrentMonth = () => {
    const currentMonth = createCurrentMonthEmployeeReceivablePeriod(today, minimumPeriodDate);
    setDraftPeriod(currentMonth);
    setPeriod(currentMonth);
  };

  const openAdd = () => {
    if (!can('customers.manage')) return;
    setForm({ ...emptyForm, branch_id: effectiveBranchId || '' });
    setEmployeeModalOpen(true);
  };

  const saveEmployee = async () => {
    if (!can('customers.manage') || !form.name.trim() || !(effectiveBranchId || form.branch_id)) return;
    setSaving(true);
    try {
      await createEmployeeCustomer({
        name: form.name.trim(),
        name_en: form.name_en.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        address: form.address.trim() || null,
        notes: form.notes.trim() || null,
        balance: 0,
        branch_id: effectiveBranchId || form.branch_id,
        customer_type: 'employee',
        employee_user_id: null,
      });
    } catch (error) {
      setSaving(false);
      show(error instanceof Error ? error.message : String(error), 'error');
      return;
    }
    setSaving(false);
    show(ar ? 'تم إنشاء حساب الموظف كعميل مصنف «موظف»' : 'Employee customer account created', 'success');
    setEmployeeModalOpen(false);
    await load();
  };

  const settle = async () => {
    if (!settling || !effectiveBranchId || !can('sales.payment.receive')) return;
    const amount = Number(settleForm.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > settling.open_amount + 0.009) {
      show(ar ? 'أدخل مبلغًا صحيحًا لا يتجاوز الرصيد الحالي المستحق' : 'Enter a valid amount not exceeding the current open balance', 'error');
      return;
    }
    setSaving(true);
    let result;
    try {
      result = await receiveEmployeeReceivablePayment({
        customerId: settling.id,
        branchId: effectiveBranchId,
        amount,
        paymentMethod: settleForm.payment_method,
        notes: settleForm.notes || null,
      });
    } catch (error) {
      setSaving(false);
      show(error instanceof Error ? error.message : String(error), 'error');
      return;
    }
    setSaving(false);
    if (!result.success) {
      show(result.detail || result.error || (ar ? 'تعذر تسجيل السداد' : 'Could not record payment'), 'error');
      return;
    }
    show(ar ? 'تم تسجيل سداد ذمة الموظف' : 'Employee receivable payment recorded', 'success');
    setSettling(null);
    setSettleForm({ amount: '', payment_method: 'cash', notes: '' });
    await load();
  };

  const columns: Column<EmployeeReceivableRow>[] = [
    {
      key: 'employee',
      header: ar ? 'الموظف' : 'Employee',
      render: (row) => <button type="button" className="text-start" onClick={() => setSelectedEmployeeId(row.id)}>
        <p className="font-bold text-ui-primary underline-offset-4 hover:underline">{row.name}</p>
        <p className="text-xs text-ui-subtle">{row.phone || row.email || '-'}</p>
      </button>,
    },
    { key: 'period_opening', header: ar ? 'رصيد أول الفترة' : 'Opening', render: (row) => formatCurrency(row.period_opening_balance, currency, lang) },
    { key: 'period_debit', header: ar ? 'مدين الفترة' : 'Period Debit', render: (row) => formatCurrency(row.period_debit, currency, lang) },
    { key: 'period_credit', header: ar ? 'المسدد خلال الفترة' : 'Paid in Period', render: (row) => formatCurrency(row.period_credit, currency, lang) },
    { key: 'period_closing', header: ar ? 'رصيد آخر الفترة' : 'Period Closing', render: (row) => <span className="font-black text-ui-text">{formatCurrency(row.period_closing_balance, currency, lang)}</span> },
    { key: 'current_open', header: ar ? 'المستحق حاليًا' : 'Current Due', render: (row) => <span className={row.open_amount > 0 ? 'font-black text-ui-danger' : 'font-medium text-ui-text'}>{formatCurrency(row.open_amount, currency, lang)}</span> },
    {
      key: 'actions',
      header: ar ? 'إجراء' : 'Action',
      render: (row) => <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => setSelectedEmployeeId(row.id)}><FileText className="h-4 w-4" />{ar ? 'كشف الحساب' : 'Statement'}</Button>
        {row.open_amount > 0 && can('sales.payment.receive') ? <Button size="sm" onClick={() => { setSettling(row); setSettleForm({ amount: String(row.open_amount), payment_method: 'cash', notes: '' }); }}><HandCoins className="h-4 w-4" />{ar ? 'سداد' : 'Settle'}</Button> : null}
      </div>,
    },
  ];

  if (selectedEmployeeId) {
    return <EmployeeReceivableDetailPage customerId={selectedEmployeeId} onBack={() => setSelectedEmployeeId(null)} />;
  }

  return (
    <DesignSurface testId="employee-receivables-page">
      <DesignPageHeader
        title={ar ? 'ذمم الموظفين' : 'Employee Receivables'}
        subtitle={ar ? 'اختر الفترة لمراجعة حركة وأرصدة جميع الموظفين في الفرع.' : 'Choose a period to review every employee account in the branch.'}
        actions={can('customers.manage') ? <Button size="sm" onClick={openAdd}><Plus className="h-4 w-4" />{ar ? 'إضافة موظف' : 'Add Employee'}</Button> : undefined}
      />

      <DesignPanel>
        <div className="grid gap-4 md:grid-cols-[minmax(220px,1fr)_minmax(220px,1fr)] md:items-end">
          {!branchFilter ? <Select label={ar ? 'الفرع' : 'Branch'} value={selectedBranchId} onChange={(e) => setSelectedBranchId(e.target.value)}><option value="">{ar ? 'اختر الفرع' : 'Select branch'}</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</Select> : <div />}
          <DesignSearch value={search} onChange={setSearch} placeholder={ar ? 'بحث بالاسم أو الهاتف' : 'Search name or phone'} label={ar ? 'بحث الموظفين' : 'Search employees'} />
        </div>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm font-black text-ui-text">{ar ? 'الفترة المحاسبية' : 'Accounting period'}</p>
            <p className="mt-1 text-xs text-ui-muted">{ar ? 'الافتراضي من بداية الشهر الحالي حتى اليوم.' : 'Defaults to the current month through today.'}</p>
          </div>
          <Button size="sm" variant="secondary" onClick={applyCurrentMonth} data-testid="employee-period-current-month">{ar ? 'الشهر الحالي' : 'Current month'}</Button>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(160px,1fr)_minmax(160px,1fr)_auto] sm:items-end">
          <label className="text-sm font-bold text-ui-text">{ar ? 'من تاريخ' : 'From date'}<input type="date" lang="en-GB-u-ca-gregory" dir="ltr" data-testid="employee-period-from" min={minimumPeriodDate} max={today} value={draftPeriod.from} onChange={(event) => setDraftPeriod({ ...draftPeriod, from: event.target.value, to: draftPeriod.to < event.target.value ? event.target.value : draftPeriod.to })} className="mt-1 block w-full rounded-xl border border-ui-border bg-ui-page p-2 font-normal" /></label>
          <label className="text-sm font-bold text-ui-text">{ar ? 'إلى تاريخ' : 'To date'}<input type="date" lang="en-GB-u-ca-gregory" dir="ltr" data-testid="employee-period-to" min={draftPeriod.from || minimumPeriodDate} max={today} value={draftPeriod.to} onChange={(event) => setDraftPeriod({ ...draftPeriod, to: event.target.value })} className="mt-1 block w-full rounded-xl border border-ui-border bg-ui-page p-2 font-normal" /></label>
          <Button onClick={applyPeriod} disabled={!periodIsValid} data-testid="employee-period-apply">{ar ? 'عرض الفترة' : 'Apply period'}</Button>
        </div>
        <p className="mt-3 text-xs text-ui-muted" data-testid="employee-period-applied">{ar ? 'الفترة المعروضة:' : 'Displayed period:'} {period.from} — {period.to}</p>
        {!history.unlimited && <p role="status" className="mt-2 text-xs text-ui-warning">{ar ? 'تفاصيل الحركات تخضع لصلاحية التاريخ؛ الرصيد الأقدم يظهر ضمن رصيد أول الفترة.' : 'Movement visibility follows history permission; older amounts are carried into the opening balance.'}</p>}
      </DesignPanel>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <DesignPanel data-testid="employee-period-total-opening"><p className="text-xs text-ui-muted">{ar ? 'إجمالي أول الفترة' : 'Total Opening'}</p><p className="mt-1 text-lg font-black text-ui-text">{formatCurrency(totals.opening, currency, lang)}</p></DesignPanel>
        <DesignPanel data-testid="employee-period-total-debit"><p className="text-xs text-ui-muted">{ar ? 'إجمالي المدين' : 'Total Debit'}</p><p className="mt-1 text-lg font-black text-ui-danger">{formatCurrency(totals.debit, currency, lang)}</p></DesignPanel>
        <DesignPanel data-testid="employee-period-total-credit"><p className="text-xs text-ui-muted">{ar ? 'إجمالي المسدد' : 'Total Paid'}</p><p className="mt-1 text-lg font-black text-ui-success">{formatCurrency(totals.credit, currency, lang)}</p></DesignPanel>
        <DesignPanel data-testid="employee-period-total-closing"><p className="text-xs text-ui-muted">{ar ? 'إجمالي آخر الفترة' : 'Total Closing'}</p><p className="mt-1 text-lg font-black text-ui-text">{formatCurrency(totals.closing, currency, lang)}</p></DesignPanel>
        <DesignPanel data-testid="employee-period-total-current"><p className="text-xs text-ui-muted">{ar ? 'المستحق حاليًا' : 'Current Due'}</p><p className="mt-1 text-lg font-black text-ui-danger">{formatCurrency(totals.current, currency, lang)}</p></DesignPanel>
      </div>

      {!effectiveBranchId
        ? <DesignPanel><div className="py-8 text-center text-sm text-ui-muted">{ar ? 'اختر الفرع لعرض ذمم الموظفين.' : 'Select a branch to view employee receivables.'}</div></DesignPanel>
        : <DesignPanel><DataTable columns={columns} data={filtered} loading={loading} emptyMessage={ar ? 'لا توجد حسابات موظفين في الفرع أو الفترة المحددة' : 'No employee accounts in this branch or period'} /></DesignPanel>}

      <Modal open={employeeModalOpen} onClose={() => setEmployeeModalOpen(false)} title={ar ? 'إضافة موظف' : 'Add Employee'}>
        <div className="space-y-4">
          <div className="rounded-xl bg-ui-info-soft p-3 text-xs text-ui-info"><UserRound className="mb-1 h-4 w-4" />{ar ? 'هذا السجل عميل مصنف «موظف» ولا ينشئ مستخدم دخول ولا صلاحيات.' : 'This creates an employee-classified customer only; no login user or permissions are created.'}</div>
          <div className="grid grid-cols-2 gap-4"><Input label={ar ? 'الاسم' : 'Name'} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /><Input label={ar ? 'الاسم بالإنجليزية' : 'English Name'} value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} /><Input label={ar ? 'الهاتف' : 'Phone'} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /><Input label={ar ? 'البريد الإلكتروني' : 'Email'} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          {!branchFilter && <Select label={ar ? 'الفرع' : 'Branch'} value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}><option value="">--</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</Select>}
          <Input label={ar ? 'العنوان' : 'Address'} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          <Textarea label={ar ? 'ملاحظات' : 'Notes'} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setEmployeeModalOpen(false)}>{ar ? 'إلغاء' : 'Cancel'}</Button><Button onClick={() => void saveEmployee()} disabled={saving || !form.name.trim()}>{saving ? (ar ? 'جاري الحفظ...' : 'Saving...') : (ar ? 'حفظ' : 'Save')}</Button></div>
        </div>
      </Modal>

      <Modal open={!!settling} onClose={() => setSettling(null)} title={settling ? `${ar ? 'سداد ذمة' : 'Settle'} - ${settling.name}` : ''}>
        <div className="space-y-4"><Input label={ar ? 'المبلغ' : 'Amount'} type="number" min={0.01} step="0.01" value={settleForm.amount} onChange={(e) => setSettleForm({ ...settleForm, amount: e.target.value })} /><Select label={ar ? 'طريقة السداد' : 'Payment Method'} value={settleForm.payment_method} onChange={(e) => setSettleForm({ ...settleForm, payment_method: e.target.value })}><option value="cash">{ar ? 'كاش' : 'Cash'}</option><option value="card">{ar ? 'بطاقة' : 'Card'}</option><option value="transfer">{ar ? 'تحويل' : 'Transfer'}</option></Select><Textarea label={ar ? 'ملاحظات' : 'Notes'} value={settleForm.notes} onChange={(e) => setSettleForm({ ...settleForm, notes: e.target.value })} rows={2} /><div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setSettling(null)}>{ar ? 'إلغاء' : 'Cancel'}</Button><Button onClick={() => void settle()} disabled={saving}>{saving ? (ar ? 'جاري الحفظ...' : 'Saving...') : (ar ? 'تسجيل السداد' : 'Record Payment')}</Button></div></div>
      </Modal>
    </DesignSurface>
  );
}
