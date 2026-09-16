import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, HandCoins, Plus, UserRound } from 'lucide-react';
import { supabase } from '@/api';
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
import type { ArAgingRow } from '@/lib/types';
import { EmployeeReceivableDetailPage } from './EmployeeReceivableDetailPage';

type EmployeeCustomer = {
  id: string;
  name: string;
  name_en: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  branch_id: string;
  customer_type: 'employee';
};

type EmployeeReceivableRow = EmployeeCustomer & {
  open_amount: number;
  bucket_0_30: number;
  bucket_31_60: number;
  bucket_61_90: number;
  bucket_90_plus: number;
};

type EmployeePaymentResult = {
  success?: boolean;
  error?: string;
  detail?: string;
};

const emptyForm = { name: '', name_en: '', phone: '', email: '', address: '', notes: '', branch_id: '' };

export function EmployeeReceivablesPage() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const can = useCan();
  const branchFilter = useBranchFilter();
  const { branches } = useBranches();
  const { effectiveSettings } = useSettings();
  const { show } = useToast();
  const [selectedBranchId, setSelectedBranchId] = useState(branchFilter || '');
  const effectiveBranchId = branchFilter || selectedBranchId;
  const currency = effectiveSettings(effectiveBranchId || null)?.currency || 'EGP';
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
    const [customersRes, agingRes] = await Promise.all([
      supabase
        .from('customers')
        .select('id,name,name_en,phone,email,address,notes,branch_id,customer_type')
        .eq('branch_id', effectiveBranchId)
        .eq('customer_type', 'employee')
        .order('name'),
      supabase.rpc('get_employee_receivable_balances', {
        p_branch_id: effectiveBranchId,
        p_as_of: new Date().toISOString().slice(0, 10),
      }),
    ]);
    if (customersRes.error) {
      show(customersRes.error.message, 'error');
      setRows([]);
      setLoading(false);
      return;
    }
    if (agingRes.error) {
      show(agingRes.error.message, 'error');
      setRows([]);
      setLoading(false);
      return;
    }
    const agingRows = (agingRes.data || []) as ArAgingRow[];
    const agingByCustomer = new Map(agingRows.map((row) => [row.customer_id, row]));
    const employeeRows = ((customersRes.data || []) as EmployeeCustomer[]).map((customer) => {
      const aging = agingByCustomer.get(customer.id);
      return {
        ...customer,
        open_amount: Number(aging?.open_amount || 0),
        bucket_0_30: Number(aging?.bucket_0_30 || 0),
        bucket_31_60: Number(aging?.bucket_31_60 || 0),
        bucket_61_90: Number(aging?.bucket_61_90 || 0),
        bucket_90_plus: Number(aging?.bucket_90_plus || 0),
      };
    });
    setRows(employeeRows);
    setLoading(false);
  }, [effectiveBranchId, can, show]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => row.name.toLowerCase().includes(q) || row.phone?.includes(q) || row.email?.toLowerCase().includes(q));
  }, [rows, search]);

  const totalOpen = useMemo(() => rows.reduce((sum, row) => sum + row.open_amount, 0), [rows]);

  const openAdd = () => {
    if (!can('customers.manage')) return;
    setForm({ ...emptyForm, branch_id: effectiveBranchId || '' });
    setEmployeeModalOpen(true);
  };

  const saveEmployee = async () => {
    if (!can('customers.manage') || !form.name.trim() || !(effectiveBranchId || form.branch_id)) return;
    setSaving(true);
    const { error } = await supabase.from('customers').insert({
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
    setSaving(false);
    if (error) {
      show(error.message, 'error');
      return;
    }
    show(ar ? 'تم إنشاء حساب الموظف كعميل مصنف «موظف»' : 'Employee customer account created', 'success');
    setEmployeeModalOpen(false);
    await load();
  };

  const settle = async () => {
    if (!settling || !effectiveBranchId || !can('sales.payment.receive')) return;
    const amount = Number(settleForm.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > settling.open_amount + 0.009) {
      show(ar ? 'أدخل مبلغًا صحيحًا لا يتجاوز الرصيد المستحق' : 'Enter a valid amount not exceeding the open balance', 'error');
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.rpc('receive_employee_receivable_payment', {
      p_customer_id: settling.id,
      p_branch_id: effectiveBranchId,
      p_amount: amount,
      p_payment_method: settleForm.payment_method,
      p_notes: settleForm.notes || null,
    });
    setSaving(false);
    const result = (data || {}) as EmployeePaymentResult;
    if (error || !result.success) {
      show(error?.message || result.detail || result.error || (ar ? 'تعذر تسجيل السداد' : 'Could not record payment'), 'error');
      return;
    }
    show(ar ? 'تم تسجيل سداد ذمة الموظف' : 'Employee receivable payment recorded', 'success');
    setSettling(null);
    setSettleForm({ amount: '', payment_method: 'cash', notes: '' });
    await load();
  };

  const columns: Column<EmployeeReceivableRow>[] = [
    { key: 'employee', header: ar ? 'الموظف' : 'Employee', render: (row) => <button type="button" className="text-start" onClick={() => setSelectedEmployeeId(row.id)}><p className="font-bold text-ui-primary underline-offset-4 hover:underline">{row.name}</p><p className="text-xs text-ui-subtle">{row.phone || row.email || '-'}</p></button> },
    { key: 'open', header: ar ? 'الرصيد المستحق' : 'Open Balance', render: (row) => <span className={row.open_amount > 0 ? 'font-black text-ui-danger' : 'font-medium text-ui-text'}>{formatCurrency(row.open_amount, currency, lang)}</span> },
    { key: '0_30', header: '0–30', render: (row) => formatCurrency(row.bucket_0_30, currency, lang) },
    { key: '31_60', header: '31–60', render: (row) => formatCurrency(row.bucket_31_60, currency, lang) },
    { key: '61_90', header: '61–90', render: (row) => formatCurrency(row.bucket_61_90, currency, lang) },
    { key: '90_plus', header: '90+', render: (row) => formatCurrency(row.bucket_90_plus, currency, lang) },
    { key: 'actions', header: ar ? 'إجراء' : 'Action', render: (row) => <div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={() => setSelectedEmployeeId(row.id)}><FileText className="h-4 w-4" />{ar ? 'كشف الحساب' : 'Statement'}</Button>{row.open_amount > 0 && can('sales.payment.receive') ? <Button size="sm" onClick={() => { setSettling(row); setSettleForm({ amount: String(row.open_amount), payment_method: 'cash', notes: '' }); }}><HandCoins className="h-4 w-4" />{ar ? 'سداد' : 'Settle'}</Button> : null}</div> },
  ];

  if (selectedEmployeeId) {
    return <EmployeeReceivableDetailPage customerId={selectedEmployeeId} onBack={() => setSelectedEmployeeId(null)} />;
  }

  return (
    <DesignSurface testId="employee-receivables-page">
      <DesignPageHeader
        title={ar ? 'ذمم الموظفين' : 'Employee Receivables'}
        subtitle={ar ? 'الموظف حساب عميل مصنف «موظف» ومستقل عن مستخدمي النظام.' : 'Employees are customer accounts classified independently from system users.'}
        actions={can('customers.manage') ? <Button size="sm" onClick={openAdd}><Plus className="h-4 w-4" />{ar ? 'إضافة موظف' : 'Add Employee'}</Button> : undefined}
      />

      <DesignPanel>
        <div className="grid gap-4 md:grid-cols-[minmax(220px,1fr)_minmax(220px,1fr)_auto] md:items-end">
          {!branchFilter ? <Select label={ar ? 'الفرع' : 'Branch'} value={selectedBranchId} onChange={(e) => setSelectedBranchId(e.target.value)}><option value="">{ar ? 'اختر الفرع' : 'Select branch'}</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</Select> : <div />}
          <DesignSearch value={search} onChange={setSearch} placeholder={ar ? 'بحث بالاسم أو الهاتف' : 'Search name or phone'} label={ar ? 'بحث' : 'Search'} />
          <div className="rounded-xl border border-ui-border bg-ui-page-alt px-4 py-3 text-end"><p className="text-xs text-ui-muted">{ar ? 'إجمالي الذمم' : 'Total Receivables'}</p><p className="text-lg font-black text-ui-danger">{formatCurrency(totalOpen, currency, lang)}</p></div>
        </div>
      </DesignPanel>

      {!effectiveBranchId ? <DesignPanel><div className="py-8 text-center text-sm text-ui-muted">{ar ? 'اختر الفرع لعرض ذمم الموظفين.' : 'Select a branch to view employee receivables.'}</div></DesignPanel> : <DesignPanel><DataTable columns={columns} data={filtered} loading={loading} emptyMessage={ar ? 'لا توجد حسابات موظفين' : 'No employee accounts'} /></DesignPanel>}

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
