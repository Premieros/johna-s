import { useCan } from '@/lib/permissions';
import { MAX_REPORT_SOURCE_ROWS } from './reportReadLimits';
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

type Summary = { raw: PeriodCloseRaw; sales: number; purchases: number; expenses: number; consumption: number | null; unpriced: number; missingRecipes: number; invalidUnits: number; unattributed: number; partial: boolean; recipeError?: string };

export function PeriodCloseReport() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const canExport = useCan()('reports.export');
  const [exportState, setExportState] = useState<{scope: string; busy?: boolean; error?: string}>();
  const branch = useBranchFilter();
  const { user } = useAuth();
  const permissions = useReportPermissionVersion();
  const [from, setFrom] = useState(() => todayISO().slice(0, 7) + '-01');
  const [to, setTo] = useState(todayISO);
  const scope = JSON.stringify([branch, user?.id, permissions, from, to]);
  const [state, setState] = useState<{ scope: string; pending?: boolean; error?: string; data?: Summary }>();
  const [detail, setDetail] = useState<'result' | 'materials' | DocumentKind>('result');
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
      const recipe = await reporting.getSoldRecipeConsumptionReport({ p_branch_id: branch, p_from_date: from, p_to_date: to,
        p_group_by: 'material', p_search: '', p_page: 0, p_page_size: 1 }, controller.signal);
      const costs = recipe.data?.summary;
      const usable = costs && !recipe.error && Number.isFinite(costs.total);
      if (!controller.signal.aborted) setState({ scope, data: { raw: response.data, sales, purchases, expenses,
        consumption: usable ? costs.total : null, unpriced: costs?.unpriced_count ?? 0,
        missingRecipes: costs?.missing_recipe_count ?? 0, invalidUnits: costs?.invalid_unit_count ?? 0,
        unattributed: costs?.unattributed_count ?? 0, partial: Boolean(costs && !costs.complete),
        recipeError: usable ? undefined : userFacingErrorMessage(recipe.error ?? new Error('REPORT_SOURCE_INVALID'), lang) } });
    } catch (error) {
      if (!controller.signal.aborted) setState({ scope, error: userFacingErrorMessage(error, lang) });
    }
  }

  const data = current?.data;
  const raw = data?.raw;
  const consumption = data?.consumption ?? null;
  const cost = data && consumption !== null ? consumption + data.expenses : null;
  const format = new Intl.NumberFormat(lang, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  const rows: [string, string, number | null][] = data ? [
    ['صافي المبيعات', 'Net sales', data.sales],
    ['جرد أول المدة – الخامات', 'Opening raw stock count', raw?.opening_complete ? raw.opening : null],
    ['صافي مشتريات الخامات بآخر سعر', 'Net raw purchases at latest prices', data.raw.purchase],
    ['صافي تحويلات الخامات بآخر سعر', 'Net raw transfers at latest prices', data.raw.transfer],
    ['جرد آخر المدة – الخامات', 'Closing raw stock count', raw?.closing_complete ? raw.closing : null],
    ['تكلفة استهلاك صافي المبيعات', 'Net sales consumption cost', consumption],
    ['صافي فواتير المشتريات', 'Net invoiced purchases', data.purchases],
    ['المصروفات المرحلة', 'Posted expenses', data.expenses],
    ['فواتير المشتريات والمصروفات (للمراجعة)', 'Invoiced purchases and expenses (reference)', data.purchases + data.expenses],
    ['إجمالي التكلفة التقديرية', 'Estimated total cost', cost],
    ['الربح أو الخسارة التقديرية', 'Estimated profit or loss', cost !== null ? data.sales - cost : null],
  ] : [];
  async function exportFullReport() {
    if (!data || !branch || !canExport || exportState?.busy) return;
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setExportState({ scope, busy: true });
    try {
      if (!data.raw.materials) throw new Error('REPORT_SOURCE_INVALID');
      const XLSX = await import('xlsx');
      const book = XLSX.utils.book_new();
      const label = (arabic: string, english: string) => ar ? arabic : english;
      const sheet = (name: string, records: Record<string, unknown>[]) => {
        const tab = XLSX.utils.json_to_sheet(records.length ? records : [{ [label('الحالة', 'Status')]: label('لا توجد بنود', 'No entries') }]);
        if (tab['!ref']) tab['!autofilter'] = { ref: tab['!ref'] };
        XLSX.utils.book_append_sheet(book, tab, name);
      };
      sheet(label('نتيجة الإقفال', 'Closing result'), rows.map(([arabic, english, value]) => ({
        [label('الفرع', 'Branch ID')]: branch, [label('من', 'From')]: from, [label('إلى', 'To')]: to,
        [label('البيان', 'Item')]: label(arabic, english), [label('القيمة', 'Amount')]: value,
        [label('نسبة صافي المبيعات (%)', 'Percent of net sales')]: value !== null && data.sales !== 0 ? value / data.sales * 100 : null,
        [label('ملاحظات', 'Notes')]: value === null ? label('راجع حالة البند في التقرير', 'See report for item status') : '',
      })));
      sheet(label('مراجعة المخزون', 'Inventory review'), data.raw.materials.map(m => ({
        [label('الخامة', 'Material')]: m.name, [label('الكود', 'Code')]: m.code,
        [label('آخر سعر', 'Latest price')]: m.price, [label('مصدر السعر', 'Price source')]: m.source ?? label('بلا سعر', 'Unpriced'),
        [label('كمية أول المدة', 'Opening quantity')]: m.opening, [label('قيمة أول المدة', 'Opening value')]: m.opening === null ? null : m.opening * m.price,
        [label('صافي الشراء', 'Net purchase quantity')]: m.purchase, [label('قيمة الشراء', 'Purchase value')]: m.purchase * m.price,
        [label('صافي التحويل', 'Net transfer quantity')]: m.transfer, [label('قيمة التحويل', 'Transfer value')]: m.transfer * m.price,
        [label('كمية آخر المدة', 'Closing quantity')]: m.closing, [label('قيمة آخر المدة', 'Closing value')]: m.closing === null ? null : m.closing * m.price,
      })));
      const { startIso, endExclusiveIso } = reportDateRangeUtc(from, to);
      let remaining = MAX_REPORT_SOURCE_ROWS;
      for (const [kind, name] of [['sales', label('فواتير المبيعات', 'Sales invoices')], ['purchases', label('فواتير المشتريات', 'Purchase invoices')], ['expenses', label('المصروفات', 'Expenses')]] as const) {
        const records: Record<string, unknown>[] = [];
        let count: number | undefined;
        for (let page = 0; count === undefined || records.length < count; page++) {
          controller.signal.throwIfAborted();
          const response = await reporting.getOperationalReportPage({ p_report_type: kind, p_branch_id: branch, p_from_date: from, p_to_date: to,
            p_from_ts: startIso, p_to_exclusive_ts: endExclusiveIso, p_filters: {}, p_page: page, p_page_size: 200 }, controller.signal);
          if (response.error || !response.data) throw response.error ?? new Error('REPORT_SOURCE_INVALID');
          if (count === undefined) count = response.data.summary.count;
          if (!Number.isSafeInteger(count) || count < 0 || count !== response.data.summary.count) throw new Error('REPORT_SOURCE_INVALID');
          if (count > remaining) throw new Error('REPORT_SOURCE_LIMIT');
          if (response.data.rows.length !== Math.min(200, count - records.length)) throw new Error('REPORT_SOURCE_INVALID');
          records.push(...response.data.rows.map(row => {
            const total = Number(kind === 'expenses' ? row.amount ?? 0 : row.total ?? 0);
            const returned = Number(kind === 'sales' ? row.refunded_amount ?? 0 : kind === 'purchases' ? row.returned_amount ?? 0 : 0);
            const party = (kind === 'sales' ? row.customer : kind === 'purchases' ? row.supplier : row.expense_account) as {name?: string} | null;
            return { [label('المستند', 'Document')]: row.invoice_number ?? row.expense_number ?? row.reference_number ?? row.id,
              [label('التاريخ', 'Date')]: row.expense_date ?? row.created_at, [label('الطرف أو التصنيف', 'Party or category')]: party?.name ?? row.description,
              [label('القيمة', 'Amount')]: total, [label('المرتجع', 'Returned')]: returned,
              [label('الصافي', 'Net')]: kind === 'expenses' ? total : Math.max(0, total - returned) };
          }));
        }
        remaining -= records.length;
        sheet(name, records);
      }
      controller.signal.throwIfAborted();
      XLSX.writeFile(book, `period-close-${from}-${to}.xlsx`);
    } catch (error) {
      if (!controller.signal.aborted) setExportState({ scope, error: userFacingErrorMessage(error, lang) });
    } finally {
      setExportState(previous => previous?.scope === scope && previous.busy ? undefined : previous);
    }
  }
  return <section className="space-y-3">
    <div className="flex flex-wrap items-end gap-3">
      <label>{ar ? 'من' : 'From'} <input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
      <label>{ar ? 'إلى' : 'To'} <input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
      <button type="button" className="rounded bg-ui-primary px-4 py-2 text-ui-primary-fg disabled:opacity-50" disabled={!valid || current?.pending || exportState?.scope === scope && exportState.busy} onClick={() => void load()}>{current?.pending ? (ar ? 'جارٍ التحميل…' : 'Loading…') : (ar ? 'عرض التقرير' : 'Run report')}</button>
      {data && canExport && <button type="button" className="rounded border border-ui-border px-4 py-2 font-bold" disabled={exportState?.scope === scope && exportState.busy} onClick={() => void exportFullReport()}>
        {exportState?.scope === scope && exportState.busy ? (ar ? 'جارٍ تجهيز Excel…' : 'Preparing Excel…') : (ar ? 'تصدير التقرير الكامل Excel' : 'Export full report to Excel')}
      </button>}
    </div>
    {!branch && <p>{ar ? 'اختر فرعًا من محدد الفروع.' : 'Select a branch.'}</p>}
    {branch && !valid && <p>{ar ? 'اختر فترة من يومين إلى 93 يومًا.' : 'Select a period of 2 to 93 days.'}</p>}
    {exportState?.scope === scope && exportState.error && <p role="alert">{exportState.error}</p>}
    {current?.error && <p role="alert">{current.error}</p>}
    {data && <div className="overflow-auto">
      <p>{ar ? 'تقييم الخامات بآخر سعر معتمد بتاريخ' : 'Raw stock valued at latest approved prices as of'} {new Date(data.raw.valued_at).toLocaleString(lang, { timeZone: 'Africa/Cairo' })}</p>
      {data.recipeError && <p role="alert">{ar ? 'تعذر تحميل تكلفة الاستهلاك:' : 'Could not load consumption cost:'} {data.recipeError}</p>}
      {(data.missingRecipes > 0 || data.invalidUnits > 0 || data.unattributed > 0 || (data.partial && !data.unpriced)) && <p role="status">
        {ar ? 'التكلفة والربح تقديريان حسب البيانات المدخلة. لاستكمال النتيجة راجع:' : 'Cost and profit reflect the recorded data. To complete the estimate, review:'}
        {' '}{ar ? 'وصفات ناقصة' : 'Missing recipes'}: {data.missingRecipes} · {ar ? 'وحدات غير مضبوطة' : 'Unresolved units'}: {data.invalidUnits} · {ar ? 'بنود غير مرتبطة' : 'Unattributed lines'}: {data.unattributed}
      </p>}
      {data.unpriced > 0 && <p role="status">{ar ? 'خامات استهلاك المبيعات بلا سعر محسوبة بصفر:' : 'Unpriced sales-consumption materials counted at zero:'} {data.unpriced}</p>}
      {data.raw.unpriced > 0 && <p role="status">{ar ? 'خامات بلا سعر محسوبة بصفر:' : 'Unpriced materials counted at zero:'} {data.raw.unpriced}</p>}
      <h2 className="mt-4 font-bold">{ar ? 'تفاصيل بنود الإقفال' : 'Period close details'}</h2>
      <div className="flex flex-wrap gap-2 py-2">
        {([['result', 'نتيجة الإقفال', 'Closing result'], ['materials', 'مراجعة المخزون', 'Inventory review'], ['sales', 'فواتير المبيعات', 'Sales invoices'], ['purchases', 'فواتير المشتريات', 'Purchase invoices'], ['expenses', 'مستندات المصروفات', 'Expense documents']] as const).map(([key, label, english]) =>
          <button key={key} type="button" aria-pressed={detail === key} className="rounded border border-ui-border px-3 py-2 aria-pressed:bg-ui-primary aria-pressed:text-ui-primary-fg" onClick={() => setDetail(key)}>{ar ? label : english}</button>)}
      </div>
      {detail === 'result' && <div className="overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-ui-surface"><tr><th className="p-3 text-start">{ar ? 'البيان' : 'Item'}</th><th>{ar ? 'القيمة (جنيه)' : 'Value (EGP)'}</th><th>{ar ? 'من صافي المبيعات' : '% of net sales'}</th></tr></thead>
        <tbody>{rows.map(([label, english, value]) => <tr key={english} className="border-t border-ui-border">
          <th className="sticky start-0 bg-ui-surface p-3 text-start">{ar ? label : english}</th>
          <td className="p-3 text-center tabular-nums">{value === null ? (english === 'Opening raw stock count' ? (ar ? 'لا يوجد جرد كامل مُرحّل لأول المدة' : 'No complete applied opening count') : english === 'Closing raw stock count' ? (ar ? 'لا يوجد جرد كامل مُرحّل لآخر المدة' : 'No complete applied closing count') : (ar ? 'تعذر تحميل تكلفة الاستهلاك' : 'Consumption cost could not be loaded')) : format.format(value)}</td>
          <td className="p-3 text-center tabular-nums">{value === null || data.sales === 0 ? '—' : format.format(value / data.sales * 100) + '%'}</td>
        </tr>)}</tbody>
      </table>
      </div>}
      {detail !== 'materials' && detail !== 'result' && branch && <PeriodCloseDocuments key={scope + detail} kind={detail} branch={branch} from={from} to={to} />}
      {detail === 'materials' && (!raw?.materials ? <p role="status">{ar ? 'لم تصل تفاصيل الخامات؛ أعد عرض التقرير.' : 'Material details were not returned; run the report again.'}</p> : <>
        <p>{ar ? 'كل حركة تعرض الكمية ثم القيمة بآخر سعر معتمد. إذا غاب الجرد أو لم تُدرج الخامة فيه، يظهر السبب في نفس الخانة.' : 'Each movement shows quantity and then value at the latest approved price. Missing counts are labelled in the table.'}</p>
        <div className="max-h-[65vh] overflow-auto"><table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-ui-surface"><tr>{(ar ? ['الخامة', 'آخر سعر', 'مصدر السعر', 'أول المدة', 'صافي الشراء', 'صافي التحويل', 'آخر المدة'] : ['Material', 'Latest price', 'Price source', 'Opening', 'Net purchases', 'Net transfers', 'Closing']).map(label => <th className="p-2 text-start" key={label}>{label}</th>)}</tr></thead>
          <tbody>{raw.materials.map(material => {
            const { opening, closing, purchase, transfer, price, source } = material;
            const label = source === 'purchase' ? (ar ? 'شراء' : 'Purchase') : source === 'pricing' ? (ar ? 'تسعير' : 'Pricing') : source === 'stock_count' ? (ar ? 'جرد مُرحّل' : 'Applied count') : source ?? (ar ? 'بلا سعر' : 'Unpriced');
            return <tr key={material.id} className="border-t border-ui-border">
              <th className="sticky start-0 bg-ui-surface p-2 text-start">{material.name} <small>{material.code}</small></th>
              <td className="p-2">{format.format(price)}</td><td className="p-2">{label}</td>
              {[opening, purchase, transfer, closing].map((quantity, index) => <td key={index} className="whitespace-nowrap p-2 tabular-nums">{quantity === null ? (ar ? 'لا توجد كمية جرد' : 'No counted quantity') : <>{new Intl.NumberFormat(lang, { maximumFractionDigits: 4 }).format(quantity)}<br />{format.format(quantity * price)}</>}</td>)}
            </tr>;
          })}</tbody>
        </table></div>
        {!raw.materials.length && <p>{ar ? 'لا توجد بنود خامات لهذه الفترة.' : 'No material lines for this period.'}</p>}
      </>)}
    </div>}
  </section>;
}
