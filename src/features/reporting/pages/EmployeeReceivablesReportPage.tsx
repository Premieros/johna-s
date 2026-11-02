import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import * as api from '@/api';
import { Button } from '@/components/Button';
import { DataTable, type Column } from '@/components/DataTable';
import { DesignPanel } from '@/components/design/DesignPanel';
import { DesignPageHeader, DesignSurface } from '@/components/design/DesignSurface';
import { useLanguage } from '@/context/LanguageContext';
import { useSettings } from '@/context/SettingsContext';
import { formatCurrency } from '@/lib/format';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useCan } from '@/lib/permissions';
import { useHistoryAccess } from '@/lib/useHistoryAccess';
import { exportToExcelAdvanced } from '@/lib/excel';
import { userFacingErrorMessage } from '@/lib/userFacingError';
import type { EmployeeReceivablePeriodRow } from '@/lib/types';

type Period = { from: string; to: string };

function cairoToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function currentMonth(today: string): Period {
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

const roundMoney = (value: number) => Number(value.toFixed(2));

export function EmployeeReceivablesReportPage() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const can = useCan();
  const history = useHistoryAccess();
  const branchId = useBranchFilter();
  const { effectiveSettings } = useSettings();
  const currency = effectiveSettings(branchId)?.currency || 'EGP';
  const today = useMemo(() => cairoToday(), []);
  const initialPeriod = useMemo(() => currentMonth(today), [today]);
  const [draft, setDraft] = useState<Period>(initialPeriod);
  const [period, setPeriod] = useState<Period>(initialPeriod);
  const [rows, setRows] = useState<EmployeeReceivablePeriodRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  const valid = Boolean(
    draft.from && draft.to && draft.from <= draft.to && draft.to <= today,
  );

  const load = useCallback(async () => {
    if (!branchId || !can('accounts.view')) {
      setRows([]);
      setLoaded(false);
      setLoading(false);
      setError('');
      return;
    }
    setLoading(true);
    setRows([]);
    setLoaded(false);
    setError('');
    try {
      const { data, error: readError } = await api.accounting.getEmployeeReceivablesPeriodSummary({
        p_branch_id: branchId,
        p_from_date: period.from,
        p_to_date: period.to,
      });
      if (readError) throw readError;
      if (!Array.isArray(data)) throw new Error('REPORT_SOURCE_INVALID');
      setRows(data);
      setLoaded(true);
    } catch (readError) {
      setRows([]);
      setLoaded(false);
      setError(userFacingErrorMessage(readError, lang));
    } finally {
      setLoading(false);
    }
  }, [branchId, can, period.from, period.to, lang]);

  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(() => rows.reduce((sum, row) => ({
    opening: sum.opening + Number(row.period_opening_balance || 0),
    debit: sum.debit + Number(row.period_debit || 0),
    credit: sum.credit + Number(row.period_credit || 0),
    closing: sum.closing + Number(row.period_closing_balance || 0),
  }), { opening: 0, debit: 0, credit: 0, closing: 0 }), [rows]);

  const columns: Column<EmployeeReceivablePeriodRow>[] = [
    { key: 'employee', header: ar ? 'الموظف' : 'Employee', render: (row) => <span className="font-bold text-ui-text">{row.employee_name}</span> },
    { key: 'phone', header: ar ? 'الهاتف' : 'Phone', render: (row) => row.phone || '-' },
    { key: 'opening', header: ar ? 'رصيد أول الفترة' : 'Opening Balance', render: (row) => formatCurrency(Number(row.period_opening_balance || 0), currency, lang) },
    { key: 'debit', header: ar ? 'مدين الفترة' : 'Period Debit', render: (row) => formatCurrency(Number(row.period_debit || 0), currency, lang) },
    { key: 'credit', header: ar ? 'المسدد خلال الفترة' : 'Paid in Period', render: (row) => formatCurrency(Number(row.period_credit || 0), currency, lang) },
    { key: 'closing', header: ar ? 'رصيد آخر الفترة' : 'Closing Balance', render: (row) => <span className="font-black text-ui-text">{formatCurrency(Number(row.period_closing_balance || 0), currency, lang)}</span> },
  ];

  const applyPeriod = () => {
    if (!valid) return;
    setPeriod(draft);
  };

  const applyCurrentMonth = () => {
    const next = currentMonth(today);
    setDraft(next);
    setPeriod(next);
  };

  const exportReport = () => {
    if (!loaded || loading || !rows.length) return;
    const labels = {
      employee: ar ? 'الموظف' : 'Employee',
      phone: ar ? 'الهاتف' : 'Phone',
      opening: ar ? 'رصيد أول الفترة' : 'Opening Balance',
      debit: ar ? 'مدين الفترة' : 'Period Debit',
      credit: ar ? 'المسدد خلال الفترة' : 'Paid in Period',
      closing: ar ? 'رصيد آخر الفترة' : 'Closing Balance',
    };
    const data = rows.map((row) => ({
      [labels.employee]: row.employee_name,
      [labels.phone]: row.phone || '',
      [labels.opening]: Number(row.period_opening_balance || 0),
      [labels.debit]: Number(row.period_debit || 0),
      [labels.credit]: Number(row.period_credit || 0),
      [labels.closing]: Number(row.period_closing_balance || 0),
    }));
    void exportToExcelAdvanced({
      data,
      filename: `employee_receivables_${period.from}_${period.to}`,
      sheetName: ar ? 'ذمم الموظفين' : 'Employee Receivables',
      title: ar ? 'تقرير ذمم الموظفين' : 'Employee Receivables Report',
      subtitle: `${period.from} — ${period.to}`,
      columns: [labels.employee, labels.phone, labels.opening, labels.debit, labels.credit, labels.closing],
      totalRow: {
        [labels.opening]: roundMoney(totals.opening),
        [labels.debit]: roundMoney(totals.debit),
        [labels.credit]: roundMoney(totals.credit),
        [labels.closing]: roundMoney(totals.closing),
      },
      currencyColumns: [labels.opening, labels.debit, labels.credit, labels.closing],
      columnWidths: { [labels.employee]: 28, [labels.phone]: 18 },
      lang: ar ? 'ar' : 'en',
    });
  };

  if (!can('accounts.view')) {
    return <DesignSurface><p role="alert">{ar ? 'لا تملك صلاحية عرض ذمم الموظفين.' : 'You do not have permission to view employee receivables.'}</p></DesignSurface>;
  }

  return (
    <DesignSurface testId="employee-receivables-period-report">
      <DesignPageHeader
        title={ar ? 'تقرير ذمم الموظفين' : 'Employee Receivables Report'}
        subtitle={ar ? 'تقرير قراءة فقط لحسابات جميع الموظفين خلال الفترة المحددة؛ لا يغيّر الأرصدة أو السداد.' : 'Read-only report for all employee accounts in the selected period. It does not change balances or payments.'}
        actions={<div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => void load()} disabled={loading} data-testid="employee-report-refresh"><RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />{ar ? 'تحديث' : 'Refresh'}</Button>
          <Button size="sm" onClick={exportReport} disabled={!loaded || loading || rows.length === 0} data-testid="employee-report-export"><Download className="h-4 w-4" />{ar ? 'تصدير Excel' : 'Export Excel'}</Button>
        </div>}
      />
      <DesignPanel>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm font-black text-ui-text">{ar ? 'الفترة المحاسبية' : 'Accounting Period'}</p>
            <p className="mt-1 text-xs text-ui-muted">{ar ? 'الافتراضي من أول الشهر الحالي حتى اليوم.' : 'Defaults to the first day of the current month through today.'}</p>
          </div>
          <Button size="sm" variant="secondary" onClick={applyCurrentMonth} data-testid="employee-report-current-month">{ar ? 'الشهر الحالي' : 'Current Month'}</Button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(160px,1fr)_minmax(160px,1fr)_auto] sm:items-end">
          <label className="text-sm font-bold text-ui-text">{ar ? 'من تاريخ' : 'From date'}<input type="date" lang="en-GB-u-ca-gregory" dir="ltr" max={today} value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value, to: draft.to < event.target.value ? event.target.value : draft.to })} className="mt-1 block w-full rounded-xl border border-ui-border bg-ui-page p-2 font-normal" data-testid="employee-report-from" /></label>
          <label className="text-sm font-bold text-ui-text">{ar ? 'إلى تاريخ' : 'To date'}<input type="date" lang="en-GB-u-ca-gregory" dir="ltr" min={draft.from} max={today} value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} className="mt-1 block w-full rounded-xl border border-ui-border bg-ui-page p-2 font-normal" data-testid="employee-report-to" /></label>
          <Button onClick={applyPeriod} disabled={!valid || loading} data-testid="employee-report-apply">{ar ? 'عرض التقرير' : 'Run Report'}</Button>
        </div>
        <p className="mt-3 text-xs text-ui-muted" data-testid="employee-report-period">{ar ? 'الفترة المعروضة:' : 'Report period:'} {period.from} — {period.to}</p>
        {!history.unlimited && <p role="status" className="mt-2 text-xs text-ui-warning">{ar ? 'تفاصيل الفترات الأقدم تخضع لصلاحية إظهار التاريخ؛ قد تكون بعض الحركات القديمة غير ظاهرة في الإجماليات.' : 'Older period details follow financial history visibility; some older movements may not be visible in these totals.'}</p>}
      </DesignPanel>

      {loaded && !loading && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <DesignPanel testId="employee-report-total-opening"><p className="text-xs text-ui-muted">{ar ? 'إجمالي رصيد أول الفترة' : 'Total Opening Balance'}</p><p className="mt-1 text-lg font-black text-ui-text">{formatCurrency(totals.opening, currency, lang)}</p></DesignPanel>
          <DesignPanel testId="employee-report-total-debit"><p className="text-xs text-ui-muted">{ar ? 'إجمالي المدين' : 'Total Debit'}</p><p className="mt-1 text-lg font-black text-ui-danger">{formatCurrency(totals.debit, currency, lang)}</p></DesignPanel>
          <DesignPanel testId="employee-report-total-credit"><p className="text-xs text-ui-muted">{ar ? 'إجمالي المسدد' : 'Total Paid'}</p><p className="mt-1 text-lg font-black text-ui-success">{formatCurrency(totals.credit, currency, lang)}</p></DesignPanel>
          <DesignPanel testId="employee-report-total-closing"><p className="text-xs text-ui-muted">{ar ? 'إجمالي رصيد آخر الفترة' : 'Total Closing Balance'}</p><p className="mt-1 text-lg font-black text-ui-text">{formatCurrency(totals.closing, currency, lang)}</p></DesignPanel>
        </div>
      </div>}
      <DesignPanel>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-bold text-ui-text">{ar ? 'تفاصيل الموظفين' : 'Employee Details'}</p>
          {loaded && <p className="text-xs text-ui-muted">{rows.length} {ar ? 'موظف' : 'employees'}</p>}
        </div>
        {!branchId
          ? <p className="py-8 text-center text-sm text-ui-muted">{ar ? 'اختر فرعًا متاحًا لعرض التقرير.' : 'Select an accessible branch to view this report.'}</p>
          : error
            ? <p role="alert" className="py-6 text-sm text-ui-danger">{error}</p>
            : <DataTable columns={columns} data={rows} loading={loading} emptyMessage={loaded ? (ar ? 'لا توجد حسابات موظفين في الفرع المحدد.' : 'No employee accounts in the selected branch.') : (ar ? 'اضغط عرض التقرير لتحميل البيانات.' : 'Run the report to load data.')} />}
      </DesignPanel>
    </DesignSurface>
  );
}
