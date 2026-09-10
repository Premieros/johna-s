import { useCallback, useEffect, useState } from 'react';
import { HandCoins, Link2, Users } from 'lucide-react';
import * as api from '@/api';
import { supabase } from '@/api';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { Input, Select, Textarea } from '@/components/Input';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { useCan } from '@/lib/permissions';
import { formatCurrency } from '@/lib/format';

type EmployeeCreditRow = {
  employee_id: string;
  customer_id: string;
  employee_name: string;
  phone: string | null;
  open_amount: number;
  bucket_0_30: number;
  bucket_31_60: number;
  bucket_61_90: number;
  bucket_90_plus: number;
};

type EmployeeOption = { id: string; full_name: string | null; email: string | null; branch_id: string | null };
type CustomerOption = { id: string; name: string; employee_user_id?: string | null };

type BalanceResult = { success?: boolean; error?: string; rows?: EmployeeCreditRow[] };

interface Props {
  branchId: string | null;
  currency: string;
}

export function EmployeeCreditPanel({ branchId, currency }: Props) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const { show } = useToast();
  const can = useCan();
  const [rows, setRows] = useState<EmployeeCreditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [settling, setSettling] = useState<EmployeeCreditRow | null>(null);
  const [settleForm, setSettleForm] = useState({ amount: '', payment_method: 'cash', notes: '' });
  const [linkOpen, setLinkOpen] = useState(false);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [linkForm, setLinkForm] = useState({ employee_id: '', customer_id: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!branchId || !can('accounts.view')) {
      setRows([]);
      setError('');
      return;
    }
    setLoading(true);
    const { data, error: rpcError } = await api.accounting.getEmployeeCreditBalances({ p_branch_id: branchId });
    const payload = data as BalanceResult | null;
    if (rpcError || !payload?.success) {
      setRows([]);
      setError(rpcError?.message || payload?.error || (ar ? 'تعذر تحميل ذمم الموظفين' : 'Could not load employee credit'));
    } else {
      setRows(payload.rows || []);
      setError('');
    }
    setLoading(false);
  }, [branchId, can, ar]);

  useEffect(() => { void load(); }, [load]);

  const openLink = async () => {
    if (!branchId || !can('customers.manage')) return;
    setLinkOpen(true);
    setLinkForm({ employee_id: '', customer_id: '' });
    const [usersRes, customersRes] = await Promise.all([
      supabase.from('users').select('id,full_name,email,branch_id').eq('is_active', true),
      supabase.from('customers').select('id,name,employee_user_id').eq('branch_id', branchId).order('name'),
    ]);
    const userRows = ((usersRes.data || []) as EmployeeOption[])
      .filter((u) => u.branch_id === branchId || u.branch_id === null);
    const customerRows = ((customersRes.data || []) as unknown as CustomerOption[])
      .filter((c) => !c.employee_user_id);
    setEmployees(userRows);
    setCustomers(customerRows);
  };

  const linkAccount = async () => {
    if (!branchId || !linkForm.employee_id || !linkForm.customer_id || !can('customers.manage')) return;
    setSaving(true);
    const { data, error: rpcError } = await api.accounting.linkEmployeeCreditAccount({
      p_customer_id: linkForm.customer_id,
      p_employee_id: linkForm.employee_id,
      p_branch_id: branchId,
    });
    setSaving(false);
    const result = data as { success?: boolean; error?: string; detail?: string } | null;
    if (rpcError || !result?.success) {
      show(rpcError?.message || result?.detail || result?.error || (ar ? 'تعذر ربط حساب الموظف' : 'Could not link employee account'), 'error');
      return;
    }
    show(ar ? 'تم ربط حساب العميل بالموظف. استخدم هذا العميل مع طريقة الدفع «آجل» في نقطة البيع.' : 'Employee account linked. Use this customer with Credit in POS.', 'success');
    setLinkOpen(false);
    await load();
  };

  const settle = async () => {
    if (!branchId || !settling || !can('sales.payment.receive')) return;
    const amount = Number(settleForm.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > Number(settling.open_amount) + 0.009) {
      show(ar ? 'أدخل مبلغًا صحيحًا لا يتجاوز الرصيد المستحق' : 'Enter a valid amount not exceeding the open balance', 'error');
      return;
    }
    setSaving(true);
    const { data, error: rpcError } = await api.accounting.receiveEmployeeCreditPayment({
      p_employee_id: settling.employee_id,
      p_branch_id: branchId,
      p_amount: amount,
      p_payment_method: settleForm.payment_method,
      p_sale_id: null,
      p_notes: settleForm.notes || null,
    });
    setSaving(false);
    const result = data as { success?: boolean; error?: string; detail?: string; reference_number?: string } | null;
    if (rpcError || !result?.success) {
      show(rpcError?.message || result?.detail || result?.error || (ar ? 'تعذر تسجيل السداد' : 'Could not record payment'), 'error');
      return;
    }
    show(`${ar ? 'تم تسجيل السداد' : 'Payment recorded'} ${result.reference_number || ''}`, 'success');
    setSettling(null);
    setSettleForm({ amount: '', payment_method: 'cash', notes: '' });
    await load();
  };

  if (!can('accounts.view')) return null;

  return (
    <div className="space-y-4" data-testid="employee-credit-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ui-border bg-ui-surface p-4">
        <div>
          <p className="font-black text-ui-text">{ar ? 'ذمم الموظفين' : 'Employee Receivables'}</p>
          <p className="mt-1 text-xs text-ui-muted">{ar ? 'الآجل للموظفين يستخدم نفس حسابات العملاء المدينة دون إنشاء رصيد موازٍ.' : 'Employee credit reuses the existing customer AR ledger; no parallel balance is created.'}</p>
        </div>
        {branchId && can('customers.manage') && (
          <Button variant="outline" size="sm" onClick={() => void openLink()} data-testid="link-employee-credit-account">
            <Link2 className="h-4 w-4" /> {ar ? 'ربط حساب موظف' : 'Link Employee Account'}
          </Button>
        )}
      </div>

      {!branchId ? (
        <div className="rounded-xl border border-ui-border bg-ui-page-alt p-4 text-sm text-ui-muted">
          {ar ? 'اختر فرعًا أولًا. لا يوجد فرع بديل تلقائي.' : 'Select a branch first. No fallback branch is used.'}
        </div>
      ) : loading ? (
        <div className="py-8 text-center text-sm text-ui-muted">{ar ? 'جاري تحميل ذمم الموظفين...' : 'Loading employee receivables...'}</div>
      ) : error ? (
        <div className="rounded-xl bg-ui-danger-soft p-4 text-sm text-ui-danger">{error}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-ui-border bg-ui-page-alt p-5 text-center text-sm text-ui-muted"><Users className="mx-auto mb-2 h-6 w-6" />{ar ? 'لا توجد ذمم موظفين مستحقة' : 'No employee receivables'}</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-ui-border">
          <table className="w-full text-sm">
            <thead className="bg-ui-page-alt text-ui-muted"><tr>
              <th className="px-3 py-2 text-start">{ar ? 'الموظف' : 'Employee'}</th>
              <th className="px-3 py-2 text-end">{ar ? 'الرصيد' : 'Open'}</th>
              <th className="px-3 py-2 text-end">0–30</th>
              <th className="px-3 py-2 text-end">31–60</th>
              <th className="px-3 py-2 text-end">61–90</th>
              <th className="px-3 py-2 text-end">90+</th>
              <th className="px-3 py-2 text-start">{ar ? 'إجراء' : 'Action'}</th>
            </tr></thead>
            <tbody className="divide-y divide-ui-border">
              {rows.map((row) => <tr key={row.employee_id}>
                <td className="px-3 py-2"><p className="font-bold text-ui-text">{row.employee_name}</p><p className="text-xs text-ui-subtle">{row.phone || '-'}</p></td>
                <td className="px-3 py-2 text-end font-black text-ui-danger">{formatCurrency(Number(row.open_amount), currency, lang)}</td>
                <td className="px-3 py-2 text-end">{formatCurrency(Number(row.bucket_0_30), currency, lang)}</td>
                <td className="px-3 py-2 text-end">{formatCurrency(Number(row.bucket_31_60), currency, lang)}</td>
                <td className="px-3 py-2 text-end">{formatCurrency(Number(row.bucket_61_90), currency, lang)}</td>
                <td className="px-3 py-2 text-end">{formatCurrency(Number(row.bucket_90_plus), currency, lang)}</td>
                <td className="px-3 py-2">{can('sales.payment.receive') && <Button size="sm" onClick={() => { setSettling(row); setSettleForm({ amount: String(row.open_amount), payment_method: 'cash', notes: '' }); }}><HandCoins className="h-4 w-4" />{ar ? 'سداد' : 'Settle'}</Button>}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={linkOpen} onClose={() => setLinkOpen(false)} title={ar ? 'ربط حساب عميل بموظف' : 'Link Customer Account to Employee'}>
        <div className="space-y-4">
          <p className="rounded-xl bg-ui-info-soft p-3 text-xs text-ui-info">{ar ? 'أنشئ/اختر حساب عميل للموظف ثم استخدمه في POS مع طريقة الدفع «آجل». لا يتم إنشاء طريقة دفع جديدة.' : 'Choose an existing customer account for the employee, then use it in POS with Credit. No new payment method is created.'}</p>
          <Select label={ar ? 'الموظف' : 'Employee'} value={linkForm.employee_id} onChange={(e) => setLinkForm({ ...linkForm, employee_id: e.target.value })}>
            <option value="">--</option>
            {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name || employee.email || employee.id}</option>)}
          </Select>
          <Select label={ar ? 'حساب العميل' : 'Customer Account'} value={linkForm.customer_id} onChange={(e) => setLinkForm({ ...linkForm, customer_id: e.target.value })}>
            <option value="">--</option>
            {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
          </Select>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setLinkOpen(false)}>{ar ? 'إلغاء' : 'Cancel'}</Button><Button onClick={() => void linkAccount()} disabled={saving || !linkForm.employee_id || !linkForm.customer_id}>{saving ? (ar ? 'جاري الحفظ...' : 'Saving...') : (ar ? 'ربط الحساب' : 'Link Account')}</Button></div>
        </div>
      </Modal>

      <Modal open={!!settling} onClose={() => setSettling(null)} title={settling ? `${ar ? 'سداد ذمة' : 'Settle'} - ${settling.employee_name}` : ''}>
        <div className="space-y-4">
          <Input label={ar ? 'المبلغ' : 'Amount'} type="number" min={0.01} step="0.01" value={settleForm.amount} onChange={(e) => setSettleForm({ ...settleForm, amount: e.target.value })} />
          <Select label={ar ? 'طريقة السداد' : 'Payment Method'} value={settleForm.payment_method} onChange={(e) => setSettleForm({ ...settleForm, payment_method: e.target.value })}>
            <option value="cash">{ar ? 'كاش' : 'Cash'}</option>
            <option value="card">{ar ? 'بطاقة' : 'Card'}</option>
            <option value="transfer">{ar ? 'تحويل' : 'Transfer'}</option>
          </Select>
          <Textarea label={ar ? 'ملاحظات' : 'Notes'} value={settleForm.notes} onChange={(e) => setSettleForm({ ...settleForm, notes: e.target.value })} rows={2} />
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setSettling(null)}>{ar ? 'إلغاء' : 'Cancel'}</Button><Button onClick={() => void settle()} disabled={saving}>{saving ? (ar ? 'جاري الحفظ...' : 'Saving...') : (ar ? 'تسجيل السداد' : 'Record Payment')}</Button></div>
        </div>
      </Modal>
    </div>
  );
}
