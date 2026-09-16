import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, HandCoins } from 'lucide-react';
import { supabase } from '@/api';
import { Button } from '@/components/Button';
import { DataTable, type Column } from '@/components/DataTable';
import { DesignPageHeader, DesignSurface } from '@/components/design/DesignSurface';
import { DesignPanel } from '@/components/design/DesignPanel';
import { useToast } from '@/components/Toast';
import { useLanguage } from '@/context/LanguageContext';
import { useSettings } from '@/context/SettingsContext';
import { formatCurrency } from '@/lib/format';
import { useCan } from '@/lib/permissions';

type EmployeeCustomer = {
  id: string;
  name: string;
  name_en: string | null;
  phone: string | null;
  email: string | null;
  branch_id: string;
};

type StatementRow = {
  id: string;
  occurred_at: string;
  kind: 'historical' | 'sale' | 'payment';
  reference: string | null;
  description: string;
  payment_method: string | null;
  debit: number;
  credit: number;
  balance: number;
};

type Props = { customerId: string; onBack: () => void };

const dateText = (value: string, lang: string) => new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-GB', {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
}).format(new Date(value));

export function EmployeeReceivableDetailPage({ customerId, onBack }: Props) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const can = useCan();
  const { effectiveSettings } = useSettings();
  const { show } = useToast();
  const [employee, setEmployee] = useState<EmployeeCustomer | null>(null);
  const [rows, setRows] = useState<StatementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const currency = effectiveSettings(employee?.branch_id || null)?.currency || 'EGP';

  const load = useCallback(async () => {
    if (!customerId || !can('accounts.view')) return;
    setLoading(true);
    const customerRes = await supabase
      .from('customers')
      .select('id,name,name_en,phone,email,branch_id,customer_type')
      .eq('id', customerId)
      .eq('customer_type', 'employee')
      .maybeSingle();

    if (customerRes.error || !customerRes.data) {
      show(customerRes.error?.message || (ar ? 'تعذر العثور على الموظف' : 'Employee not found'), 'error');
      setEmployee(null);
      setRows([]);
      setLoading(false);
      return;
    }

    const customer = customerRes.data as EmployeeCustomer;
    setEmployee(customer);
    const [entriesRes, salesRes, paymentsRes] = await Promise.all([
      supabase.from('employee_receivable_entries').select('id,occurred_at,reference_number,entry_type,amount,notes').eq('customer_id', customer.id).eq('branch_id', customer.branch_id).order('occurred_at', { ascending: true }),
      supabase.from('sales').select('id,invoice_number,total,paid_amount,refunded_amount,payment_method,status,notes,created_at').eq('customer_id', customer.id).eq('branch_id', customer.branch_id).order('created_at', { ascending: true }),
      supabase.from('customer_payments').select('id,amount,payment_method,reference_number,notes,created_at,sale_id').eq('customer_id', customer.id).eq('branch_id', customer.branch_id).order('created_at', { ascending: true }),
    ]);

    const firstError = entriesRes.error || salesRes.error || paymentsRes.error;
    if (firstError) {
      show(firstError.message, 'error');
      setRows([]);
      setLoading(false);
      return;
    }

    const movements: Omit<StatementRow, 'balance'>[] = [];
    for (const entry of entriesRes.data || []) {
      movements.push({ id: `entry-${entry.id}`, occurred_at: entry.occurred_at, kind: 'historical', reference: entry.reference_number, description: entry.notes || (entry.entry_type === 'opening_balance' ? (ar ? 'رصيد افتتاحي' : 'Opening balance') : (ar ? 'حركة ذمة تاريخية' : 'Historical receivable')), payment_method: null, debit: Number(entry.amount || 0), credit: 0 });
    }
    for (const sale of salesRes.data || []) {
      if (sale.status === 'returned') continue;
      movements.push({ id: `sale-${sale.id}`, occurred_at: sale.created_at, kind: 'sale', reference: sale.invoice_number, description: sale.notes || (ar ? 'بيع آجل للموظف' : 'Employee credit sale'), payment_method: sale.payment_method, debit: Math.max(Number(sale.total || 0) - Number(sale.refunded_amount || 0), 0), credit: Math.max(Number(sale.paid_amount || 0), 0) });
    }
    for (const payment of paymentsRes.data || []) {
      movements.push({ id: `payment-${payment.id}`, occurred_at: payment.created_at, kind: 'payment', reference: payment.reference_number, description: payment.notes || (ar ? 'سداد ذمة' : 'Receivable payment'), payment_method: payment.payment_method, debit: 0, credit: Number(payment.amount || 0) });
    }

    movements.sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime() || a.id.localeCompare(b.id));
    let running = 0;
    setRows(movements.map((movement) => ({ ...movement, balance: (running += movement.debit - movement.credit) })));
    setLoading(false);
  }, [customerId, can, show, ar]);

  useEffect(() => { void load(); }, [load]);
  const totals = useMemo(() => rows.reduce((acc, row) => ({ debit: acc.debit + row.debit, credit: acc.credit + row.credit }), { debit: 0, credit: 0 }), [rows]);
  const currentBalance = rows.length ? rows[rows.length - 1].balance : 0;

  const columns: Column<StatementRow>[] = [
    { key: 'date', header: ar ? 'التاريخ' : 'Date', render: (row) => dateText(row.occurred_at, lang) },
    { key: 'kind', header: ar ? 'نوع الحركة' : 'Type', render: (row) => row.kind === 'sale' ? (ar ? 'مبيعات' : 'Sale') : row.kind === 'payment' ? (ar ? 'سداد' : 'Payment') : (ar ? 'ذمة تاريخية' : 'Historical') },
    { key: 'reference', header: ar ? 'رقم العملية / المرجع' : 'Transaction / Reference', render: (row) => row.reference || '-' },
    { key: 'description', header: ar ? 'البيان' : 'Description', render: (row) => row.description || '-' },
    { key: 'method', header: ar ? 'طريقة / مصدر الحركة' : 'Method / Source', render: (row) => row.payment_method || '-' },
    { key: 'debit', header: ar ? 'مدين' : 'Debit', render: (row) => row.debit ? formatCurrency(row.debit, currency, lang) : '-' },
    { key: 'credit', header: ar ? 'دائن / مسدد' : 'Credit / Paid', render: (row) => row.credit ? formatCurrency(row.credit, currency, lang) : '-' },
    { key: 'balance', header: ar ? 'الرصيد بعد الحركة' : 'Running Balance', render: (row) => <span className="font-bold">{formatCurrency(row.balance, currency, lang)}</span> },
  ];

  const BackIcon = ar ? ArrowRight : ArrowLeft;
  return (
    <DesignSurface testId="employee-receivable-detail-page">
      <DesignPageHeader title={employee ? `${ar ? 'كشف حساب' : 'Statement'} — ${employee.name}` : (ar ? 'كشف حساب الموظف' : 'Employee Statement')} subtitle={employee ? [employee.phone, employee.email].filter(Boolean).join(' • ') : undefined} actions={<Button variant="secondary" size="sm" onClick={onBack}><BackIcon className="h-4 w-4" />{ar ? 'العودة لذمم الموظفين' : 'Back to receivables'}</Button>} />
      <div className="grid gap-3 md:grid-cols-3">
        <DesignPanel><p className="text-xs text-ui-muted">{ar ? 'إجمالي المديونية' : 'Total Debit'}</p><p className="mt-1 text-xl font-black text-ui-danger">{formatCurrency(totals.debit, currency, lang)}</p></DesignPanel>
        <DesignPanel><p className="text-xs text-ui-muted">{ar ? 'إجمالي المسدد' : 'Total Paid'}</p><p className="mt-1 text-xl font-black text-ui-success">{formatCurrency(totals.credit, currency, lang)}</p></DesignPanel>
        <DesignPanel><p className="text-xs text-ui-muted">{ar ? 'الرصيد الحالي' : 'Current Balance'}</p><p className="mt-1 flex items-center gap-2 text-xl font-black text-ui-text"><HandCoins className="h-5 w-5" />{formatCurrency(currentBalance, currency, lang)}</p></DesignPanel>
      </div>
      <DesignPanel><DataTable columns={columns} data={rows} loading={loading} emptyMessage={ar ? 'لا توجد حركات لهذا الموظف' : 'No transactions for this employee'} /></DesignPanel>
    </DesignSurface>
  );
}
