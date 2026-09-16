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
import type { ArAgingRow } from '@/lib/types';

type EmployeeCustomer = {
  id: string;
  name: string;
  name_en: string | null;
  phone: string | null;
  email: string | null;
  branch_id: string;
};

type PartyStatementRow = {
  line_id: string;
  entry_date: string;
  entry_number: string | null;
  reference_type: string | null;
  reference_number: string | null;
  description: string | null;
  debit: number | string;
  credit: number | string;
};

type PartyStatement = {
  rows?: PartyStatementRow[];
};

type StatementRow = {
  id: string;
  occurred_at: string;
  kind: 'opening' | 'sale' | 'payment' | 'adjustment';
  reference: string | null;
  description: string;
  source: string | null;
  debit: number;
  credit: number;
  balance: number;
};

type Props = { customerId: string; onBack: () => void };

const OPENING_DATE = '2026-09-16';
const OPENING_OCCURRED_AT = '2026-09-16T00:00:00+03:00';

const dateText = (value: string, lang: string) => new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-GB', {
  year: 'numeric', month: '2-digit', day: '2-digit',
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

    const today = new Date().toISOString().slice(0, 10);
    const [balancesRes, statementRes] = await Promise.all([
      supabase.rpc('get_employee_receivable_balances', {
        p_branch_id: customer.branch_id,
        p_as_of: today,
      }),
      supabase.rpc('get_party_statement', {
        p_branch_id: customer.branch_id,
        p_side: 'ar',
        p_party_id: customer.id,
        p_from_date: OPENING_DATE,
        p_to_date: null,
      }),
    ]);

    if (balancesRes.error || statementRes.error) {
      show(balancesRes.error?.message || statementRes.error?.message || (ar ? 'تعذر تحميل كشف الحساب' : 'Could not load statement'), 'error');
      setRows([]);
      setLoading(false);
      return;
    }

    const agingRows = (balancesRes.data || []) as ArAgingRow[];
    const currentBalance = Number(agingRows.find((row) => row.customer_id === customer.id)?.open_amount || 0);
    const statement = (statementRes.data || {}) as PartyStatement;
    const journalRows = statement.rows || [];
    const journalNet = journalRows.reduce((sum, row) => sum + Number(row.debit || 0) - Number(row.credit || 0), 0);
    const openingBalance = Number((currentBalance - journalNet).toFixed(2));

    const movements: StatementRow[] = [{
      id: `opening-${customer.id}`,
      occurred_at: OPENING_OCCURRED_AT,
      kind: 'opening',
      reference: null,
      description: ar ? 'رصيد افتتاحي معتمد' : 'Approved opening balance',
      source: ar ? 'رصيد افتتاحي' : 'Opening balance',
      debit: openingBalance,
      credit: 0,
      balance: openingBalance,
    }];

    let running = openingBalance;
    for (const row of journalRows) {
      const debit = Number(row.debit || 0);
      const credit = Number(row.credit || 0);
      running = Number((running + debit - credit).toFixed(2));
      const refType = row.reference_type || '';
      const kind: StatementRow['kind'] = /payment/i.test(refType)
        ? 'payment'
        : /sale/i.test(refType)
          ? 'sale'
          : 'adjustment';
      movements.push({
        id: row.line_id,
        occurred_at: `${row.entry_date}T12:00:00+03:00`,
        kind,
        reference: row.reference_number || row.entry_number || null,
        description: row.description || (ar ? 'حركة ذمة' : 'Receivable movement'),
        source: row.reference_type || row.entry_number || null,
        debit,
        credit,
        balance: running,
      });
    }

    setRows(movements);
    setLoading(false);
  }, [customerId, can, show, ar]);

  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(() => rows.reduce((acc, row) => ({
    debit: acc.debit + row.debit,
    credit: acc.credit + row.credit,
  }), { debit: 0, credit: 0 }), [rows]);
  const currentBalance = rows.length ? rows[rows.length - 1].balance : 0;

  const kindLabel = (kind: StatementRow['kind']) => {
    if (kind === 'opening') return ar ? 'رصيد افتتاحي' : 'Opening';
    if (kind === 'sale') return ar ? 'مبيعات آجلة' : 'Credit sale';
    if (kind === 'payment') return ar ? 'سداد' : 'Payment';
    return ar ? 'تسوية / حركة' : 'Adjustment';
  };

  const columns: Column<StatementRow>[] = [
    { key: 'date', header: ar ? 'التاريخ' : 'Date', render: (row) => dateText(row.occurred_at, lang) },
    { key: 'kind', header: ar ? 'نوع الحركة' : 'Type', render: (row) => kindLabel(row.kind) },
    { key: 'reference', header: ar ? 'رقم العملية / المرجع' : 'Transaction / Reference', render: (row) => row.reference || '-' },
    { key: 'description', header: ar ? 'البيان' : 'Description', render: (row) => row.description || '-' },
    { key: 'source', header: ar ? 'المصدر' : 'Source', render: (row) => row.source || '-' },
    { key: 'debit', header: ar ? 'مدين' : 'Debit', render: (row) => row.debit ? formatCurrency(row.debit, currency, lang) : '-' },
    { key: 'credit', header: ar ? 'دائن / مسدد' : 'Credit / Paid', render: (row) => row.credit ? formatCurrency(row.credit, currency, lang) : '-' },
    { key: 'balance', header: ar ? 'الرصيد بعد الحركة' : 'Running Balance', render: (row) => <span className="font-bold">{formatCurrency(row.balance, currency, lang)}</span> },
  ];

  const BackIcon = ar ? ArrowRight : ArrowLeft;
  return (
    <DesignSurface testId="employee-receivable-detail-page">
      <DesignPageHeader
        title={employee ? `${ar ? 'كشف حساب' : 'Statement'} — ${employee.name}` : (ar ? 'كشف حساب الموظف' : 'Employee Statement')}
        subtitle={employee ? [employee.phone, employee.email].filter(Boolean).join(' • ') : undefined}
        actions={<Button variant="secondary" size="sm" onClick={onBack}><BackIcon className="h-4 w-4" />{ar ? 'العودة لذمم الموظفين' : 'Back to receivables'}</Button>}
      />
      <div className="grid gap-3 md:grid-cols-3">
        <DesignPanel><p className="text-xs text-ui-muted">{ar ? 'إجمالي المدين' : 'Total Debit'}</p><p className="mt-1 text-xl font-black text-ui-danger">{formatCurrency(totals.debit, currency, lang)}</p></DesignPanel>
        <DesignPanel><p className="text-xs text-ui-muted">{ar ? 'إجمالي المسدد / الدائن' : 'Total Credit / Paid'}</p><p className="mt-1 text-xl font-black text-ui-success">{formatCurrency(totals.credit, currency, lang)}</p></DesignPanel>
        <DesignPanel><p className="text-xs text-ui-muted">{ar ? 'الرصيد الحالي' : 'Current Balance'}</p><p className="mt-1 flex items-center gap-2 text-xl font-black text-ui-text"><HandCoins className="h-5 w-5" />{formatCurrency(currentBalance, currency, lang)}</p></DesignPanel>
      </div>
      <DesignPanel><DataTable columns={columns} data={rows} loading={loading} emptyMessage={ar ? 'لا توجد حركات لهذا الموظف' : 'No transactions for this employee'} /></DesignPanel>
    </DesignSurface>
  );
}
