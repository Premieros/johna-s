import { useEffect, useState } from 'react';
import { reporting } from '@/api';
import { reportDateRangeUtc } from '@/lib/businessTime';
import { userFacingErrorMessage } from '@/lib/userFacingError';
import { useLanguage } from '@/context/LanguageContext';

export type DocumentKind = 'sales' | 'purchases' | 'expenses';

export function PeriodCloseDocuments({ kind, branch, from, to }: { kind: DocumentKind; branch: string; from: string; to: string }) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<{ page: number; rows?: Record<string, unknown>[]; count?: number; error?: string }>();
  const size = 50;
  useEffect(() => {
    const controller = new AbortController();
    const { startIso, endExclusiveIso } = reportDateRangeUtc(from, to);
    void reporting.getOperationalReportPage({ p_report_type: kind, p_branch_id: branch, p_from_date: from, p_to_date: to,
      p_from_ts: startIso, p_to_exclusive_ts: endExclusiveIso, p_filters: {}, p_page: page, p_page_size: size }, controller.signal)
      .then(({ data, error }) => {
        if (error || !data) throw error || new Error('REPORT_SOURCE_INVALID');
        if (!controller.signal.aborted) setResult({ page, rows: data.rows, count: data.summary.count });
      }).catch(error => {
        if (!controller.signal.aborted) setResult({ page, error: userFacingErrorMessage(error, lang) });
      });
    return () => controller.abort();
  }, [branch, from, to, kind, page, lang]);
  const current = result?.page === page ? result : undefined;
  if (!current) return <p role="status">{ar ? 'جارٍ تحميل التفاصيل…' : 'Loading details…'}</p>;
  if (current.error) return <p role="alert">{current.error}</p>;
  const number = (v: unknown) => Number(v ?? 0);
  const format = new Intl.NumberFormat(lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return <>
    <table className="w-full text-sm">
      <thead><tr>{(ar ? ['المستند', 'التاريخ', 'الطرف أو التصنيف', 'القيمة', 'المرتجع', 'الصافي'] : ['Document', 'Date', 'Party or category', 'Amount', 'Returned', 'Net']).map(label => <th key={label} className="p-2 text-start">{label}</th>)}</tr></thead>
      <tbody>{current.rows?.map(row => {
        const total = number(kind === 'expenses' ? row.amount : row.total);
        const returned = number(kind === 'sales' ? row.refunded_amount : kind === 'purchases' ? row.returned_amount : 0);
        const party = (kind === 'sales' ? row.customer : kind === 'purchases' ? row.supplier : row.expense_account) as { name?: string } | null;
        return <tr key={String(row.id)} className="border-t border-ui-border">
          {[row.invoice_number ?? row.expense_number ?? row.reference_number ?? row.id, String(row.expense_date ?? row.created_at ?? '').slice(0, 10), party?.name ?? row.description ?? '—',
            format.format(total), format.format(returned), format.format(kind === 'expenses' ? total : Math.max(0, total - returned))]
            .map((value, i) => <td key={i} className="p-2">{String(value ?? '—')}</td>)}
        </tr>;
      })}</tbody>
    </table>
    {!current.rows?.length && <p>{ar ? 'لا توجد مستندات للفترة.' : 'No documents for this period.'}</p>}
    <div className="flex gap-3 p-2">
      <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>{ar ? 'السابق' : 'Previous'}</button>
      <span>{page + 1}</span>
      <button type="button" disabled={(page + 1) * size >= (current.count ?? 0)} onClick={() => setPage(page + 1)}>{ar ? 'التالي' : 'Next'}</button>
    </div>
  </>;
}
