import { PeriodCloseEvidence, type EvidenceKind } from './PeriodCloseEvidence';
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
  const [detail, setDetail] = useState<'result' | 'materials' | 'components' | DocumentKind | EvidenceKind>('result');
  const [materialId, setMaterialId] = useState<string>();
  const [selectedRow, setSelectedRow] = useState<number>();
  const current = state?.scope === scope ? state : undefined;
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), [scope]);
  const valid = Boolean(branch && from && to && from <= to && Date.parse(to) - Date.parse(from) <= 92 * 86400000);

  async function load() {
    if (!branch || !valid || current?.pending) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setDetail('result'); setSelectedRow(undefined); setMaterialId(undefined);
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
    ['رصيد الخامات أول المدة', 'Opening raw stock balance', data.raw.opening],
    ['صافي مشتريات الخامات بآخر سعر', 'Net raw purchases at latest prices', data.raw.purchase],
    ['صافي تحويلات الخامات بآخر سعر', 'Net raw transfers at latest prices', data.raw.transfer],
    ['رصيد الخامات آخر المدة', 'Closing raw stock balance', data.raw.closing],
    ['تكلفة استهلاك صافي المبيعات', 'Net sales consumption cost', consumption],
    ['صافي فواتير المشتريات', 'Net invoiced purchases', data.purchases],
    ['المصروفات المرحلة', 'Posted expenses', data.expenses],
    ['فواتير المشتريات والمصروفات (للمراجعة)', 'Invoiced purchases and expenses (reference)', data.purchases + data.expenses],
    ['إجمالي التكلفة التقديرية', 'Estimated total cost', cost],
    ['الربح أو الخسارة التقديرية', 'Estimated profit or loss', cost !== null ? data.sales - cost : null],
  ] : [];
  function openRow(index: number) {
    const target = (['sales','materials','purchase','transfer','materials','consumption','purchases','expenses','components','components','components'] as const)[index];
    setMaterialId(undefined); setSelectedRow(index); setDetail(target);
  }
  const evidence = detail === 'all' || detail === 'purchase' || detail === 'transfer' || detail === 'consumption';
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
        [label('آخر سعر', 'Latest price')]: m.price, [label('مصدر السعر', 'Price source')]: m.source ?? label('صفر افتراضي', 'Default zero'),
        [label('كمية أول المدة', 'Opening quantity')]: m.opening, [label('قيمة أول المدة', 'Opening value')]: m.opening === null ? null : m.opening * m.price,
        [label('صافي الشراء', 'Net purchase quantity')]: m.purchase, [label('قيمة الشراء', 'Purchase value')]: m.purchase * m.price,
        [label('صافي التحويل', 'Net transfer quantity')]: m.transfer, [label('قيمة التحويل', 'Transfer value')]: m.transfer * m.price,
        [label('تسويات الجرد', 'Count adjustments')]: m.adjustment ?? 0, [label('باقي الحركات الفعلية', 'Other actual movements')]: m.other ?? 0,
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
      // Full evidence is fetched only for an explicit export, inside the same
      // combined row budget as invoices. Never silently export the first page.
      for (const kind of ['all','consumption'] as const) {
        const records: Record<string, unknown>[] = [];
        let count: number | undefined;
        for (let page = 0; count === undefined || records.length < count; page++) {
          controller.signal.throwIfAborted();
          const response = kind === 'all'
            ? await reporting.getPeriodCloseRawMovements({p_branch_id:branch,p_from:from,p_to:to,p_kind:'all',p_material_id:null,p_page:page,p_page_size:200},controller.signal)
            : await reporting.getSoldRecipeConsumptionReport({p_branch_id:branch,p_from_date:from,p_to_date:to,p_group_by:'material',p_search:'',p_page:page,p_page_size:200},controller.signal);
          if (response.error || !response.data) throw response.error ?? new Error('REPORT_SOURCE_INVALID');
          const data = response.data;
          const totalCount = 'summary' in data ? data.summary.count : data.count;
          if (count === undefined) count = totalCount;
          if (!Number.isSafeInteger(count) || count < 0 || count !== totalCount) throw new Error('REPORT_SOURCE_INVALID');
          if (count > remaining) throw new Error('REPORT_SOURCE_LIMIT');
          if (data.rows.length !== Math.min(200,count-records.length)) throw new Error('REPORT_SOURCE_INVALID');
          records.push(...data.rows.map(row => 'consumption_value' in row ? {
            [label('الخامة','Material')]:row.raw_material_name,[label('الوحدة','Unit')]:row.unit_name,
            [label('استهلاك قبل المرتجع','Gross consumption')]:row.consumed_quantity,[label('المرتجع','Returned')]:row.returned_quantity,
            [label('صافي الاستهلاك','Net consumption')]:row.net_quantity,[label('آخر سعر','Latest price')]:row.unit_price,[label('القيمة','Value')]:row.consumption_value,
          } : {
            [label('الخامة','Material')]:row.name,[label('المستند','Document')]:row.reference_number,[label('التاريخ','Date')]:row.created_at,
            [label('نوع الحركة','Movement')]:row.entry_type,[label('المخزن','Warehouse')]:row.warehouse_name,
            [label('الكمية','Quantity')]:row.quantity,[label('آخر سعر','Latest price')]:row.price,[label('القيمة','Value')]:row.value,
          }));
        }
        remaining -= records.length;
        sheet(kind === 'all' ? label('حركات الخامات','Material movements') : label('استهلاك الوصفات','Recipe consumption'),records);
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
    {branch && !valid && <p>{ar ? 'اختر فترة من يوم إلى 93 يومًا.' : 'Select a period of 1 to 93 days.'}</p>}
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
      <p className="text-sm">{ar ? 'أول المدة: قبل بداية اليوم الأول. آخر المدة: بعد حركات اليوم الأخير، بتوقيت القاهرة. الأرصدة من الحركات المسجلة، والجرد يؤثر بعد تطبيقه فقط.' : 'Opening: before the first day. Closing: after the final day’s movements, Cairo time. Balances follow posted movements; counts affect stock only after application.'}</p>
      <h2 className="mt-4 font-bold">{ar ? 'تفاصيل بنود الإقفال' : 'Period close details'}</h2>
      <div className="flex flex-wrap gap-2 py-2">
        {([['result', 'نتيجة الإقفال', 'Closing result'], ['materials', 'مراجعة المخزون', 'Inventory review'], ['sales', 'فواتير المبيعات', 'Sales invoices'], ['purchases', 'فواتير المشتريات', 'Purchase invoices'], ['expenses', 'مستندات المصروفات', 'Expense documents']] as const).map(([key, label, english]) =>
          <button key={key} type="button" aria-pressed={detail === key} className="rounded border border-ui-border px-3 py-2 aria-pressed:bg-ui-primary aria-pressed:text-ui-primary-fg" onClick={() => { setDetail(key); setSelectedRow(undefined); setMaterialId(undefined); }}>{ar ? label : english}</button>)}
      </div>
      {detail !== 'result' && <div className="flex flex-wrap items-center gap-3 py-2"><button type="button" className="rounded border border-ui-border px-3 py-2" onClick={() => setDetail('result')}>{ar ? 'العودة لنتيجة الإقفال' : 'Back to closing result'}</button><strong>{selectedRow !== undefined ? (ar ? rows[selectedRow][0] : rows[selectedRow][1]) : ''}</strong><span>{from} — {to}</span></div>}
      {detail === 'result' && <div className="overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-ui-surface"><tr><th className="p-3 text-start">{ar ? 'البيان' : 'Item'}</th><th>{ar ? 'القيمة (جنيه)' : 'Value (EGP)'}</th><th>{ar ? 'من صافي المبيعات' : '% of net sales'}</th><th>{ar ? 'التفاصيل' : 'Details'}</th></tr></thead>
        <tbody>{rows.map(([label, english, value], index) => <tr key={english} className="border-t border-ui-border">
          <th className="sticky start-0 bg-ui-surface p-3 text-start">{ar ? label : english}</th>
          <td className="p-3 text-center tabular-nums">{value === null ? (ar ? 'تعذر تحميل تكلفة الاستهلاك' : 'Consumption cost could not be loaded') : format.format(value)}</td>
          <td className="p-3 text-center tabular-nums">{value === null || data.sales === 0 ? '—' : format.format(value / data.sales * 100) + '%'}</td>
          <td className="p-2"><button type="button" className="whitespace-nowrap rounded border border-ui-border px-3 py-2" onClick={() => openRow(index)} aria-label={`${ar ? 'عرض التفاصيل' : 'View details'}: ${ar ? label : english}`}>{ar ? 'عرض التفاصيل' : 'View details'}</button></td>
        </tr>)}</tbody>
      </table>
      </div>}
      {(detail === 'sales' || detail === 'purchases' || detail === 'expenses') && branch && <PeriodCloseDocuments key={scope + detail} kind={detail} branch={branch} from={from} to={to} />}
      {evidence && branch && <PeriodCloseEvidence key={scope + detail + materialId} kind={detail as EvidenceKind} material={materialId} branch={branch} from={from} to={to} expected={detail === 'purchase' ? data.raw.purchase : detail === 'transfer' ? data.raw.transfer : detail === 'consumption' ? consumption : undefined} />}
      {detail === 'components' && <div className="space-y-2">
        <p>{ar ? 'تفصيل الحساب — اضغط على كل مكوّن لعرض مستنداته:' : 'Calculation breakdown — open each component for its evidence:'}</p>
        {(selectedRow === 8 ? [6,7] : selectedRow === 9 ? [5,7] : [0,5,7]).map(index => <div key={index} className="flex items-center gap-4 border-b border-ui-border p-3"><span>{ar ? rows[index][0] : rows[index][1]}</span><strong>{rows[index][2] === null ? '—' : format.format(rows[index][2]!)}</strong><button type="button" onClick={() => openRow(index)}>{ar ? 'عرض التفاصيل' : 'View details'}</button></div>)}
        <p>{selectedRow === 8 ? (ar ? 'فواتير المشتريات + المصروفات' : 'Purchase invoices + expenses') : selectedRow === 9 ? (ar ? 'استهلاك المبيعات + المصروفات' : 'Sales consumption + expenses') : (ar ? 'صافي المبيعات − استهلاك المبيعات − المصروفات' : 'Net sales − sales consumption − expenses')}</p>
      </div>}
      {detail === 'materials' && (!raw?.materials ? <p role="status">{ar ? 'لم تصل تفاصيل الخامات؛ أعد عرض التقرير.' : 'Material details were not returned; run the report again.'}</p> : <>
        <p>{ar ? 'كل رصيد يعرض الكمية والقيمة بآخر سعر. اضغط حركات الخامة لمراجعة تسلسل المستندات خلال الفترة.' : 'Balances show quantity and value at the latest price. Open material movements for the period document history.'}</p>
        <div className="max-h-[65vh] overflow-auto"><table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-ui-surface"><tr>{(ar ? ['الخامة', 'آخر سعر', 'مصدر السعر', 'أول المدة', 'صافي الشراء', 'صافي التحويل', 'تسويات الجرد', 'باقي الحركات الفعلية', 'آخر المدة', 'التفاصيل'] : ['Material', 'Latest price', 'Price source', 'Opening', 'Net purchases', 'Net transfers', 'Count adjustments', 'Other actual movements', 'Closing', 'Details']).map(label => <th className="p-2 text-start" key={label}>{label}</th>)}</tr></thead>
          <tbody>{raw.materials.map(material => {
            const { opening, closing, purchase, transfer, price, source, adjustment = 0, other = 0 } = material;
            const label = source === 'purchase' ? (ar ? 'شراء' : 'Purchase') : source === 'pricing' ? (ar ? 'تسعير' : 'Pricing') : source === 'stock_count' ? (ar ? 'جرد مُرحّل' : 'Applied count') : source === 'catalog_zero' ? (ar ? 'صفر افتراضي' : 'Default zero') : source ?? (ar ? 'صفر افتراضي' : 'Default zero');
            return <tr key={material.id} className="border-t border-ui-border">
              <th className="sticky start-0 bg-ui-surface p-2 text-start">{material.name} <small>{material.code}</small></th>
              <td className="p-2">{format.format(price)}</td><td className="p-2">{label}</td>
              {[opening, purchase, transfer, adjustment, other, closing].map((quantity, index) => <td key={index} className="whitespace-nowrap p-2 tabular-nums">{quantity === null ? (ar ? 'لا توجد كمية جرد' : 'No counted quantity') : <>{new Intl.NumberFormat(lang, { maximumFractionDigits: 4 }).format(quantity)}<br />{format.format(quantity * price)}</>}</td>)}
              <td className="p-2"><button type="button" className="whitespace-nowrap rounded border border-ui-border p-2" onClick={() => { setMaterialId(material.id); setDetail('all'); }}>{ar ? 'حركات الخامة' : 'Material movements'}</button></td>
            </tr>;
          })}</tbody>
          <tfoot className="sticky bottom-0 bg-ui-surface font-bold"><tr><th colSpan={3} className="p-2 text-start">{ar ? 'إجمالي القيمة (جنيه)' : 'Total value (EGP)'}</th>{(['opening','purchase','transfer','adjustment','other','closing'] as const).map(key => <td className="p-2 tabular-nums" key={key}>{format.format(raw.materials!.reduce((total,m) => total + (m[key] ?? 0) * m.price,0))}</td>)}<td /></tr></tfoot>
        </table></div>
        {!raw.materials.length && <p>{ar ? 'لا توجد بنود خامات لهذه الفترة.' : 'No material lines for this period.'}</p>}
      </>)}
    </div>}
  </section>;
}
