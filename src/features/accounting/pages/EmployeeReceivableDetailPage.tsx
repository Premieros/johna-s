import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, HandCoins } from 'lucide-react';
import { Button } from '@/components/Button';
import { DataTable, type Column } from '@/components/DataTable';
import { DesignPageHeader, DesignSurface } from '@/components/design/DesignSurface';
import { DesignPanel } from '@/components/design/DesignPanel';
import { useToast } from '@/components/Toast';
import { useLanguage } from '@/context/LanguageContext';
import { useSettings } from '@/context/SettingsContext';
import { formatCurrency } from '@/lib/format';
import { useCan } from '@/lib/permissions';
import { useHistoryAccess } from '@/lib/useHistoryAccess';
import { fetchEmployeeReceivableSnapshot, type EmployeeCustomerSnapshot } from '../services/employeeReceivableDetail';
import { buildEmployeeReceivablePeriod, createCurrentMonthEmployeeReceivablePeriod, getCairoToday, getEmployeeReceivableMinimumDate, type EmployeeReceivablePeriod } from '../services/employeeReceivablePeriod';

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
  const history = useHistoryAccess();
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
  const [employee, setEmployee] = useState<EmployeeCustomerSnapshot | null>(null);
  const [rows, setRows] = useState<StatementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const currency = effectiveSettings(employee?.branch_id || null)?.currency || 'EGP';

  const load = useCallback(async () => {
    if (!customerId || !can('accounts.view')) return;
    setLoading(true);

    try {
      const snapshot = await fetchEmployeeReceivableSnapshot({
        customerId,
        openingDate: OPENING_DATE,
      });
      const customer = snapshot.customer;
      setEmployee(customer);

      const currentBalance = Number(snapshot.agingRows.find((row) => row.customer_id === customer.id)?.open_amount || 0);
      const journalRows = snapshot.journalRows;
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
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      show(
        message === 'EMPLOYEE_NOT_FOUND'
          ? (ar ? 'تعذر العثور على الموظف' : 'Employee not found')
          : message || (ar ? 'تعذر تحميل كشف الحساب' : 'Could not load statement'),
        'error',
      );
      setEmployee(null);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [customerId, can, show, ar]);
  useEffect(() => { void load(); }, [load]);

  const periodStatement = useMemo(() => buildEmployeeReceivablePeriod(
    rows,
    period,
    ar ? 'رصيد بداية الفترة' : 'Opening balance at period start',
    ar ? 'رصيد مرحّل' : 'Brought forward',
  ), [rows, period, ar]);
  const totals = { debit: periodStatement.debit, credit: periodStatement.credit };
  const currentBalance = periodStatement.closingBalance;
  const periodIsValid = Boolean(
    draftPeriod.from && draftPeriod.to
    && draftPeriod.from >= minimumPeriodDate
    && draftPeriod.from <= draftPeriod.to
    && draftPeriod.to <= today,
  );
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
      <DesignPanel>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm font-black text-ui-text">{ar ? 'الفترة المحاسبية' : 'Accounting period'}</p>
            <p className="mt-1 text-xs text-ui-muted">{ar ? 'اختر الشهر الحالي أو حدد تاريخ البداية والنهاية.' : 'Choose the current month or set a custom date range.'}</p>
          </div>
          <Button size="sm" variant="secondary" onClick={applyCurrentMonth} data-testid="employee-period-current-month">{ar ? 'الشهر الحالي' : 'Current month'}</Button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(160px,1fr)_minmax(160px,1fr)_auto] sm:items-end">
          <label className="text-sm font-bold text-ui-text">{ar ? 'من تاريخ' : 'From date'}<input type="date" lang="en-GB-u-ca-gregory" dir="ltr" data-testid="employee-period-from" min={minimumPeriodDate} max={today} value={draftPeriod.from} onChange={(event) => setDraftPeriod({ ...draftPeriod, from: event.target.value, to: draftPeriod.to < event.target.value ? event.target.value : draftPeriod.to })} className="mt-1 block w-full rounded-xl border border-ui-border bg-ui-page p-2 font-normal" /></label>
          <label className="text-sm font-bold text-ui-text">{ar ? 'إلى تاريخ' : 'To date'}<input type="date" lang="en-GB-u-ca-gregory" dir="ltr" data-testid="employee-period-to" min={draftPeriod.from || minimumPeriodDate} max={today} value={draftPeriod.to} onChange={(event) => setDraftPeriod({ ...draftPeriod, to: event.target.value })} className="mt-1 block w-full rounded-xl border border-ui-border bg-ui-page p-2 font-normal" /></label>
          <Button onClick={applyPeriod} disabled={!periodIsValid} data-testid="employee-period-apply">{ar ? 'عرض الفترة' : 'Apply period'}</Button>
        </div>
        <p className="mt-3 text-xs text-ui-muted" data-testid="employee-period-applied">{ar ? 'الفترة المعروضة:' : 'Displayed period:'} {period.from} — {period.to}</p>
        {!history.unlimited && <p role="status" className="mt-2 text-xs text-ui-warning">{ar ? 'صلاحية التاريخ الحالية تعرض تفاصيل الحركات لآخر 7 أيام فقط، ويظهر الرصيد الأقدم كرصيد مرحّل.' : 'Your current history permission shows movement details for the last 7 days; older balance is carried forward.'}</p>}
      </DesignPanel>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <DesignPanel><p className="text-xs text-ui-muted">{ar ? 'الرصيد أول الفترة' : 'Opening Balance'}</p><p className="mt-1 text-xl font-black text-ui-text">{formatCurrency(periodStatement.openingBalance, currency, lang)}</p></DesignPanel>
        <DesignPanel><p className="text-xs text-ui-muted">{ar ? 'مدين خلال الفترة' : 'Debit in Period'}</p><p className="mt-1 text-xl font-black text-ui-danger">{formatCurrency(totals.debit, currency, lang)}</p></DesignPanel>
        <DesignPanel><p className="text-xs text-ui-muted">{ar ? 'مسدد / دائن خلال الفترة' : 'Paid / Credit in Period'}</p><p className="mt-1 text-xl font-black text-ui-success">{formatCurrency(totals.credit, currency, lang)}</p></DesignPanel>
        <DesignPanel><p className="text-xs text-ui-muted">{ar ? 'الرصيد آخر الفترة' : 'Closing Balance'}</p><p className="mt-1 flex items-center gap-2 text-xl font-black text-ui-text"><HandCoins className="h-5 w-5" />{formatCurrency(currentBalance, currency, lang)}</p></DesignPanel>
      </div>
      <DesignPanel><DataTable columns={columns} data={periodStatement.rows} loading={loading} emptyMessage={ar ? 'لا توجد حركات في الفترة المحددة' : 'No transactions in the selected period'} /></DesignPanel>
    </DesignSurface>
  );
}
