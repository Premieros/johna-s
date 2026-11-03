import { PeriodCloseDocuments, type DocumentKind } from './PeriodCloseDocuments';
import { useEffect, useRef, useState } from 'react';
import { reporting } from '@/api';
import type { PeriodCloseRaw } from '@/api/domains/reporting';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useReportPermissionVersion } from '@/hooks/useReportPermissionVersion';
import { reportDateRangeUtc } from '@/lib/businessTime';
import { todayISO } from '@/lib/format';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { userFacingErrorMessage } from '@/lib/userFacingError';

type Summary = { raw: PeriodCloseRaw; sales: number; purchases: number; expenses: number };

export function PeriodCloseReport() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const branch = useBranchFilter();
  const { user } = useAuth();
  const permissions = useReportPermissionVersion();
  const [from, setFrom] = useState(() => todayISO().slice(0, 7) + '-01');
  const [to, setTo] = useState(todayISO);
  const scope = JSON.stringify([branch, user?.id, permissions, from, to]);
  const [state, setState] = useState<{ scope: string; pending?: boolean; error?: string; data?: Summary }>();
  const [detail, setDetail] = useState<'materials' | DocumentKind>('materials');
  const current = state?.scope === scope ? state : undefined;
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), [scope]);
  const valid = Boolean(branch && from && to && from < to && Date.parse(to) - Date.parse(from) <= 92 * 86400000);

  async function load() {
    if (!branch || !valid || current?.pending) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState({ scope, pending: true });
    try {
      const { startIso, endExclusiveIso } = reportDateRangeUtc(from, to);
      const financial = async (type: 'sales' | 'purchases' | 'expenses', key: string) => {
        const response = await reporting.getOperationalReportMetrics({ p_report_type: type, p_branch_id: branch,
          p_from_date: from, p_to_date: to, p_from_ts: startIso, p_to_exclusive_ts: endExclusiveIso, p_filters: {} }, controller.signal);
        if (response.error) throw response.error;
        const value = response.data?.[key];
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('REPORT_SOURCE_INVALID');
        return value;
      };
      const response = await reporting.getPeriodCloseRaw({ p_branch_id: branch, p_from: from, p_to: to }, controller.signal);
      if (response.error) throw response.error;
      if (!response.data) throw new Error('REPORT_SOURCE_INVALID');
      const sales = await financial('sales', 'Net Sales');
      const purchases = await financial('purchases', 'Net Purchases');
      const expenses = await financial('expenses', 'Amount');
      if (!controller.signal.aborted) setState({ scope, data: { raw: response.data, sales, purchases, expenses } });
    } catch (error) {
      if (!controller.signal.aborted) setState({ scope, error: userFacingErrorMessage(error, lang) });
    }
  }

  const data = current?.data;
  const raw = data?.raw;
  const consumption = raw?.opening_complete && raw.closing_complete ? raw.opening + raw.purchase + raw.transfer - raw.closing : null;
  const cost = data && consumption !== null ? consumption + data.expenses : null;
  const format = new Intl.NumberFormat(lang, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  const rows: [string, string, number | null][] = data ? [
    ['صافي المبيعات', 'Net sales', data.sales],
    ['جرد أول المدة – الخامات', 'Opening raw stock count', raw?.opening_complete ? raw.opening : null],
    ['صافي مشتريات الخامات بآخر سعر', 'Net raw purchases at latest prices', data.raw.purchase],
    ['صافي تحويلات الخامات بآخر سعر', 'Net raw transfers at latest prices', data.raw.transfer],
    ['جرد آخر المدة – الخامات', 'Closing raw stock count', raw?.closing_complete ? raw.closing : null],
    ['استهلاك الخامات حسب الجرد', 'Raw consumption by count', consumption],
    ['صافي فواتير المشتريات', 'Net invoiced purchases', data.purchases],
    ['المصروفات المرحلة', 'Posted expenses', data.expenses],
    ['فواتير المشتريات والمصروفات (للمراجعة)', 'Invoiced purchases and expenses (reference)', data.purchases + data.expenses],
    ['إجمالي التكلفة التقديرية', 'Estimated total cost', cost],
    ['الربح أو الخسارة التقديرية', 'Estimated profit or loss', cost !== null ? data.sales - cost : null],
  ] : [];
  return <section className="space-y-3">
    <div className="flex flex-wrap items-end gap-3">
      <label>{ar ? 'من' : 'From'} <input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
      <label>{ar ? 'إلى' : 'To'} <input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
      <button type="button" className="rounded bg-ui-primary px-4 py-2 text-ui-primary-fg disabled:opacity-50" disabled={!valid || current?.pending} onClick={() => void load()}>{current?.pending ? (ar ? 'جارٍ التحميل…' : 'Loading…') : (ar ? 'عرض التقرير' : 'Run report')}</button>
    </div>
    {!branch && <p>{ar ? 'اختر فرعًا من محدد الفروع.' : 'Select a branch.'}</p>}
    {branch && !valid && <p>{ar ? 'اختر فترة من يومين إلى 93 يومًا.' : 'Select a period of 2 to 93 days.'}</p>}
    {current?.error && <p role="alert">{current.error}</p>}
    {data && <div className="overflow-auto">
      <p>{ar ? 'تقييم الخامات بآخر سعر معتمد بتاريخ' : 'Raw stock valued at latest approved prices as of'} {new Date(data.raw.valued_at).toLocaleString(lang, { timeZone: 'Africa/Cairo' })}</p>
      {consumption === null && <p role="status">{ar ? 'الإقفال مبدئي: يلزم جرد كامل مُرحّل في أول وآخر المدة للمخازن المشمولة.' : 'Preliminary: applied full counts are required at both boundaries for the warehouses in scope.'}</p>}
      {data.raw.unpriced > 0 && <p role="status">{ar ? 'خامات بلا سعر محسوبة بصفر:' : 'Unpriced materials counted at zero:'} {data.raw.unpriced}</p>}
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-ui-surface"><tr><th className="p-3 text-start">{ar ? 'البيان' : 'Item'}</th><th>{ar ? 'القيمة (جنيه)' : 'Value (EGP)'}</th><th>{ar ? 'من صافي المبيعات' : '% of net sales'}</th></tr></thead>
        <tbody>{rows.map(([label, english, value]) => <tr key={english} className="border-t border-ui-border">
          <th className="sticky start-0 bg-ui-surface p-3 text-start">{ar ? label : english}</th>
          <td className="p-3 text-center tabular-nums">{value === null ? '—' : format.format(value)}</td>
          <td className="p-3 text-center tabular-nums">{value === null || data.sales === 0 ? '—' : format.format(value / data.sales * 100) + '%'}</td>
        </tr>)}</tbody>
      </table>
      <h2 className="mt-4 font-bold">{ar ? 'تفاصيل بنود الإقفال' : 'Period close details'}</h2>
      <div className="flex flex-wrap gap-2 py-2">
        {([['materials', 'الجرد وحركة الخامات والاستهلاك', 'Counts, movements and consumption'], ['sales', 'فواتير المبيعات', 'Sales invoices'], ['purchases', 'فواتير المشتريات', 'Purchase invoices'], ['expenses', 'مستندات المصروفات', 'Expense documents']] as const).map(([key, label, english]) =>
          <button key={key} type="button" aria-pressed={detail === key} className="rounded border border-ui-border px-3 py-2 aria-pressed:bg-ui-primary aria-pressed:text-ui-primary-fg" onClick={() => setDetail(key)}>{ar ? label : english}</button>)}
      </div>
      {detail !== 'materials' && branch && <PeriodCloseDocuments key={scope + detail} kind={detail} branch={branch} from={from} to={to} />}
      {detail === 'materials' && (!raw?.materials ? <p role="status">{ar ? 'تفاصيل الخامات غير متاحة حاليًا.' : 'Material details are currently unavailable.'}</p> : <>
        <p>{ar ? 'كل حركة تعرض الكمية ثم القيمة بآخر سعر معتمد. الشرطة تعني أن الخامة غير مدرجة في الجرد.' : 'Each movement shows quantity and then value at the latest approved price. A dash means the material is not listed in the count.'}</p>
        <div className="max-h-[65vh] overflow-auto"><table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-ui-surface"><tr>{(ar ? ['الخامة', 'آخر سعر', 'مصدر السعر', 'أول المدة', 'صافي الشراء', 'صافي التحويل', 'آخر المدة', 'الاستهلاك'] : ['Material', 'Latest price', 'Price source', 'Opening', 'Net purchases', 'Net transfers', 'Closing', 'Consumption']).map(label => <th className="p-2 text-start" key={label}>{label}</th>)}</tr></thead>
          <tbody>{raw.materials.map(material => {
            const { opening, closing, purchase, transfer, price, source } = material;
            const used = consumption === null || opening === null || closing === null ? null : opening + purchase + transfer - closing;
            const label = source === 'purchase' ? (ar ? 'شراء' : 'Purchase') : source === 'pricing' ? (ar ? 'تسعير' : 'Pricing') : source === 'stock_count' ? (ar ? 'جرد مُرحّل' : 'Applied count') : source ?? (ar ? 'بلا سعر' : 'Unpriced');
            return <tr key={material.id} className="border-t border-ui-border">
              <th className="sticky start-0 bg-ui-surface p-2 text-start">{material.name} <small>{material.code}</small></th>
              <td className="p-2">{format.format(price)}</td><td className="p-2">{label}</td>
              {[opening, purchase, transfer, closing, used].map((quantity, index) => <td key={index} className="whitespace-nowrap p-2 tabular-nums">{quantity === null ? '—' : <>{new Intl.NumberFormat(lang, { maximumFractionDigits: 4 }).format(quantity)}<br />{format.format(quantity * price)}</>}</td>)}
            </tr>;
          })}</tbody>
        </table></div>
        {!raw.materials.length && <p>{ar ? 'لا توجد بنود خامات لهذه الفترة.' : 'No material lines for this period.'}</p>}
      </>)}
    </div>}
  </section>;
}
