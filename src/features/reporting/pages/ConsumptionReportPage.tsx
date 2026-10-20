import { useLayoutEffect, useRef, useState } from 'react';
import { reporting } from '@/api';
import type { ConsumptionLatestResult, ConsumptionLatestRow } from '@/api/domains/reporting';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useCan } from '@/lib/permissions';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useHistoryAccess } from '@/lib/useHistoryAccess';
import { useReportPermissionVersion } from '@/hooks/useReportPermissionVersion';
import { useSettings } from '@/context/SettingsContext';
import { todayISO } from '@/lib/format';
import { userFacingErrorMessage } from '@/lib/userFacingError';
import { exportToExcelAdvanced } from '@/lib/excel';
import { openPrintWindow } from '@/lib/reportExport';
import { Button } from '@/components/Button';
import { useColumnPreferences } from '../useColumnPreferences';
import { ColumnPicker } from '../ColumnPicker';
import { orderReportColumns } from '../reportColumnLayout';
import { MAX_REPORT_SOURCE_ROWS } from '../reportReadLimits';
import { useSearchParams } from 'react-router-dom';

type Query = { from: string; to: string; group: 'material' | 'product'; search: string };
type Snapshot = { scope: string; query: Query; page: number; result: ConsumptionLatestResult };
const validDate = (value: string | null) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : todayISO();

export function ConsumptionReportPage() {
 const { lang } = useLanguage(); const ar = lang === 'ar'; const can = useCan();
 const { user } = useAuth(); const branch = useBranchFilter(); const history = useHistoryAccess();
 const { effectiveSettings } = useSettings();
 const currency = effectiveSettings(branch)?.currency || 'EGP';
 const permissionVersion = useReportPermissionVersion(); const [params] = useSearchParams();
 const allowed = can('reports.view') && can('reports.costing');
 const scope = JSON.stringify([branch,user?.id,user?.role,permissionVersion,allowed,history.unlimited,lang]);
 const liveScope = useRef(scope); liveScope.current = scope;
 const [query,setQuery] = useState<Query>(() => ({ from: validDate(params.get('from')), to: validDate(params.get('to')), group: 'material', search: '' }));
 const [snapshot,setSnapshot] = useState<Snapshot | null>(null);
 const [busy,setBusy] = useState(false); const [error,setError] = useState<unknown>(null);
 const pending = useRef<AbortController | null>(null);
 const { visibleColumns,toggleColumn,showAllColumns,columnOrder,moveColumn,resetColumnOrder } = useColumnPreferences(`sold_recipe_consumption_v1_${lang}`);
 useLayoutEffect(() => { pending.current?.abort(); setSnapshot(null); setError(null); setBusy(false); return () => pending.current?.abort(); },[scope]);
 const result = snapshot?.scope === scope ? snapshot : null;
 const text = (arabic: string,english: string) => ar ? arabic : english;
 const edit = (change: Partial<Query>) => setQuery(previous => ({ ...previous,...change }));
 const dirty = !!result && JSON.stringify(query)!==JSON.stringify(result.query);
 const labels = {
  branch_name: text('الفرع','Branch'),product_name: text('المنتج','Product'),raw_material_name: text('الخامة','Material'),raw_material_code: text('الكود','Code'),
  unit_name: text('الوحدة','Unit'),consumed_quantity: text('المستهلك قبل الإرجاع','Gross consumption'),returned_quantity: text('الكمية المعادة','Returned quantity'),
  product_sold_quantity: text('صافي المباع بوحدة المنتج الأساسية','Net sold in base product unit'),net_quantity: text('صافي الاستهلاك','Net consumption'),unit_price: text('آخر سعر معتمد / وحدة','Latest approved / unit'),price_source: text('مصدر السعر','Price source'),
  price_date: text('تاريخ السعر','Price date'),price_reference: text('مرجع السعر','Price reference'),consumption_value: text('قيمة الاستهلاك','Consumption value'),
 };
 const keys = (Object.keys(labels) as Array<keyof typeof labels>).filter(key => (key!=='product_name' || result?.query.group==='product') && (key!=='product_sold_quantity' || result?.query.group==='product'));
 const columns = orderReportColumns(keys.map(key => labels[key]),columnOrder).filter(key => !visibleColumns || visibleColumns.includes(key));
 const number = (value: number) => new Intl.NumberFormat(lang,{ maximumFractionDigits:6 }).format(value);
 const value = (row: ConsumptionLatestRow,key: keyof typeof labels): string | number => {
  if (key==='product_name') return row.product_name || text('غير منسوب إلى منتج','Unattributed');
  if (key==='price_source') return ({purchase:text('شراء','Purchase'),pricing:text('تسعير','Pricing'),stock_count:text('جرد','Stock count'),unpriced:text('بلا سعر — محسوبة بصفر','No price — counted as zero')} as Record<string,string>)[row.price_source] || row.price_source;
  if (key==='price_date') return row.price_date ? new Date(row.price_date).toLocaleString(lang,{ timeZone:'Africa/Cairo' }) : '—';
  return row[key] ?? '—';
 };
 const records = (rows: ConsumptionLatestRow[]) => rows.map(row => Object.fromEntries(keys.filter(key => columns.includes(labels[key])).map(key => [labels[key],value(row,key)])));
 async function fetchPage(q: Query,page: number,size: number,signal: AbortSignal) {
  const dates = history.clampRange(q.from,q.to);
  if (!dates.from || !dates.to || dates.from>dates.to) throw new Error(text('حدد فترة صحيحة','Select a valid period'));
  const response = await reporting.getSoldRecipeConsumptionReport({ p_branch_id:branch || null,p_from_date:dates.from,p_to_date:dates.to,
   p_group_by:q.group,p_search:q.search.trim(),p_page:page,p_page_size:size },signal);
  signal.throwIfAborted(); if (response.error) throw response.error;
  if (!response.data || !Array.isArray(response.data.rows) || !response.data.summary || response.data.pricing_basis!=='current_recipe_latest_approved') throw new Error('REPORT_SOURCE_INVALID');
  return response.data;
 }
 async function run(page=0,q=query) {
  if (!allowed) return; pending.current?.abort(); const controller=new AbortController(); pending.current=controller;
  const requestScope=scope; setBusy(true); setError(null);
  try { const data=await fetchPage(q,page,100,controller.signal); if(liveScope.current===requestScope) setSnapshot({scope:requestScope,query:{...q},page,result:data}); }
  catch(failure) { if(!controller.signal.aborted && liveScope.current===requestScope) { setSnapshot(null); setError(failure); } }
  finally { if(pending.current===controller && liveScope.current===requestScope) setBusy(false); }
 }
 async function exportAll(kind: 'excel'|'print') {
  if (!result || busy || !columns.length || (kind==='excel' ? !can('reports.export') : !can('reports.print'))) return;
  const win=kind==='print' ? window.open('','_blank') : undefined;
  pending.current?.abort(); const controller=new AbortController(); pending.current=controller; const requestScope=scope;
  setBusy(true);setError(null);
  try {
   if(result.result.summary.count>MAX_REPORT_SOURCE_ROWS) throw new Error('REPORT_SOURCE_LIMIT');
   // One bounded export read: repeating small pages would recompute the entire
   // aggregation/summary for every page. Screen reads stay at 100 rows.
   const data=await fetchPage(result.query,0,Math.max(1,result.result.summary.count),controller.signal);
   if(JSON.stringify(data.summary)!==JSON.stringify(result.result.summary) || data.rows.length!==data.summary.count) throw new Error(text('تغيرت البيانات؛ أعد عرض التقرير قبل التصدير','Data changed; refresh before exporting'));
   const rows=data.rows;
   if(liveScope.current!==requestScope || controller.signal.aborted) { win?.close();return; }
   const output=records(rows);
   const diagnostics=`${text('وصفات ناقصة','Missing recipes')}: ${data.summary.missing_recipe_count || 0} · ${text('وحدات غير محددة','Unresolved units')}: ${data.summary.invalid_unit_count || 0} · ${data.recipe_issues?.map(issue=>issue.product_name || text('منتج غير متاح','Unavailable product')).join('، ') || '—'}`;
   const note=`${result.result.from} — ${result.result.to} · ${text('صافي المباع × الوصفة الحالية × آخر سعر معتمد؛ يشمل هالك الوصفة. الخامة بلا سعر بصفر. الإجمالي جزئي عند نقص وصفة أو وحدة، وليس تكلفة محاسبية تاريخية','Net sold × current recipe × latest approved price, including recipe waste. Missing prices count as zero; missing recipes or units make the total partial. This is not historical accounting cost')} · ${diagnostics}`;
   const title=text('استهلاك المباع حسب الوصفة الحالية','Sold-item consumption at current recipes');
   const totalLabel=text('إجمالي قيمة الاستهلاك','Total consumption value');
   const missingLabel=text('صفوف محسوبة بسعر صفر','Rows counted with zero price');
   if(kind==='excel') await exportToExcelAdvanced({data:output,columns,filename:'sold_recipe_consumption',sheetName:'Consumption',title,subtitle:`${result.result.from} — ${result.result.to} · ${currency}`,totalRow:{[labels.consumption_value]:result.result.summary.total,[missingLabel]:result.result.summary.unpriced_count},currencyColumns:[labels.unit_price,labels.consumption_value],sourceNote:note,lang});
   else openPrintWindow({title,subtitle:`${note} · ${totalLabel}: ${number(result.result.summary.total)} ${currency} · ${missingLabel}: ${result.result.summary.unpriced_count}`,headers:columns,rows:[...output.map(row=>columns.map(key=>String(row[key]??''))),columns.map(key=>key===labels.consumption_value?number(data.summary.total):key===labels.raw_material_name?text('الإجمالي','Total'):'')],lang},win);
  } catch(failure) { win?.close();if(!controller.signal.aborted && liveScope.current===requestScope) setError(failure); }
  finally { if(pending.current===controller && liveScope.current===requestScope)setBusy(false); }
 }
 if(!allowed) return <p role="alert">{text('ليس لديك صلاحية عرض تكلفة الاستهلاك','Consumption costing permission is required')}</p>;
 return <section data-testid="purchase-consumption-report" className="space-y-3">
  <details className="text-xs text-ui-muted"><summary className="cursor-pointer">{text('طريقة الحساب','Calculation details')}</summary><p className="py-2">{text('صافي المنتجات المباعة في الفترة بتوقيت القاهرة، بعد خصم المرتجعات وتحويل وحدة البيع، × الوصفة الحالية ومجموعات المكونات وهالك الوصفة × آخر سعر معتمد من أي مصدر، بما فيه السعر الابتدائي. الخامة بلا سعر تُحسب بصفر. تعديل الوصفة أو السعر يغيّر إعادة استخراج الفترات السابقة؛ هذه تكلفة نظرية وليست حركة المخزون أو التكلفة المحاسبية التاريخية. كمية المباع تتكرر أمام كل خامة للمنتج ولا تُجمع بين الخامات.','Net sold products in the Cairo date range, after refunds and sale-unit conversion, × current recipes and nested components including recipe waste × latest approved price from any source, including initial pricing. Missing prices count as zero. Recipe or price changes revalue past periods. This theoretical cost differs from inventory movements and historical accounting cost. Sold quantity repeats for each material and must not be summed across materials.')}</p></details>
  {!history.unlimited && <p role="status" className="text-sm text-ui-warning">{text('البيانات والإجماليات تخضع لصلاحية الاطلاع على التاريخ؛ يلزم التاريخ الكامل لمراجعة شهر كامل.','History visibility applies to rows and totals. Full history permission is needed for a complete month review.')}</p>}
  <details open className="rounded-lg border border-ui-border p-2"><summary className="cursor-pointer text-sm font-semibold">{text('الفترة والفلاتر','Period & filters')} · {query.from} — {query.to}</summary><form onSubmit={event=>{event.preventDefault();void run();}} className="flex flex-wrap items-end gap-3 rounded-xl border border-ui-border bg-ui-surface p-3">
   <label>{text('من','From')}<input aria-label={text('من','From')} type="date" value={query.from} onChange={event=>edit({from:event.target.value})} className="block rounded border border-ui-border bg-ui-surface p-2" /></label>
   <label>{text('إلى','To')}<input aria-label={text('إلى','To')} type="date" value={query.to} onChange={event=>edit({to:event.target.value})} className="block rounded border border-ui-border bg-ui-surface p-2" /></label>
   <label>{text('العرض حسب','Group by')}<select aria-label={text('العرض حسب','Group by')} value={query.group} onChange={event=>edit({group:event.target.value as Query['group']})} className="block rounded border border-ui-border bg-ui-surface p-2"><option value="material">{text('الخامة','Material')}</option><option value="product">{text('المنتج والخامة','Product and material')}</option></select></label>
   <label className="flex-1">{text('بحث بالخامة أو المنتج أو الكود','Material, product or code')}<input type="search" value={query.search} onChange={event=>edit({search:event.target.value})} className="block w-full min-w-40 rounded border border-ui-border bg-ui-surface p-2" /></label>

  </form></details>
  <Button size="sm" disabled={busy} onClick={()=>void run()}>{busy?text('جارٍ التحميل…','Loading…'):text('عرض التقرير','Run report')}</Button>
  {dirty && <p role="status">{text('تغيّرت الفلاتر؛ اضغط عرض التقرير لتطبيقها. النتيجة أدناه للفترة السابقة.','Filters changed. Run the report to apply them; results below use the previous selection.')}</p>}
  {!!error && <p role="alert" className="text-ui-danger">{userFacingErrorMessage(error,lang)}</p>}
  {result && <>
   <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
    <p>{result.result.from} — {result.result.to} · {text('وقت استخراج البيانات','Data generated')}: {new Date(result.result.generated_at).toLocaleString(lang,{timeZone:'Africa/Cairo'})} · {text('عدد الصفوف','Rows')}: {result.result.summary.count} · <strong>{text('إجمالي قيمة الاستهلاك','Total consumption value')}: {number(result.result.summary.total)} {currency}</strong></p>
    <div className="flex gap-2"><ColumnPicker columns={keys.map(key=>labels[key])} visibleColumns={visibleColumns} onToggle={key=>toggleColumn(key,keys.map(item=>labels[item]))} hiddenCount={keys.length-columns.length} onShowAll={showAllColumns} onMove={(key,direction)=>moveColumn(key,direction,keys.map(item=>labels[item]))} onResetOrder={resetColumnOrder} lang={lang} />
    {can('reports.export') && <Button variant="outline" disabled={busy || !columns.length} onClick={()=>void exportAll('excel')}>Excel</Button>}
    {can('reports.print') && <Button variant="outline" disabled={busy || !columns.length} onClick={()=>void exportAll('print')}>{text('طباعة / PDF','Print / PDF')}</Button>}</div>
   </div>
   {result.result.summary.unpriced_count>0 && <p role="status" className="rounded bg-ui-warning-soft p-3">{text('صفوف محسوبة بسعر صفر','Rows counted with zero price')}: {result.result.summary.unpriced_count}</p>}
   {!!((result.result.summary.missing_recipe_count || 0)+(result.result.summary.invalid_unit_count || 0)) && <p role="status" className="rounded bg-ui-warning-soft p-3">{text('الإجمالي جزئي: توجد وصفات أو وحدات بيع ناقصة؛ راجع المنتجات التالية قبل الاعتماد على التكلفة.','Partial total: recipes or sale units are missing. Review these products before relying on the cost.')} {result.result.recipe_issues?.map(issue=>issue.product_name || text('منتج محذوف أو غير متاح','Deleted or unavailable product')).join('، ')}</p>}
   <div className="report-grid rounded-lg border border-ui-border" data-explicit-primary="true"><table className="w-full border-collapse text-sm"><thead className="sticky top-0 z-10 bg-ui-page-alt"><tr>{columns.map(key=><th key={key} data-primary={key===(columns.includes(labels.raw_material_name)?labels.raw_material_name:columns[0])} scope="col" className="whitespace-nowrap border-b border-ui-border px-3 py-3 text-start">{key}</th>)}</tr></thead><tbody>{records(result.result.rows).map((row,index)=><tr key={index} className="odd:bg-ui-surface even:bg-ui-page-alt hover:bg-ui-primary/5">{columns.map(key=><td key={key} data-primary={key===(columns.includes(labels.raw_material_name)?labels.raw_material_name:columns[0])} className="whitespace-nowrap border-b border-ui-border px-3 py-2 tabular-nums">{typeof row[key]==='number'?number(row[key] as number):String(row[key])}</td>)}</tr>)}</tbody><tfoot><tr data-testid="consumption-grand-total">{columns.map(key=><td key={key} data-primary={key===(columns.includes(labels.raw_material_name)?labels.raw_material_name:columns[0])}>{key===labels.consumption_value ? `${number(result.result.summary.total)} ${currency}` : key===labels.raw_material_name ? `${text('إجمالي التقرير الكامل','Full report total')} · ${result.result.summary.count}` : ''}</td>)}</tr></tfoot></table>{!result.result.rows.length && <p className="p-6 text-center">{text('لا توجد خامات لوصفات المباع في الفترة المختارة','No sold-recipe materials in this period')}</p>}</div>
   <div className="flex items-center justify-center gap-3"><Button variant="outline" disabled={busy || result.page===0} onClick={()=>void run(result.page-1,result.query)}>{text('السابق','Previous')}</Button><span>{result.page+1} / {Math.max(1,Math.ceil(result.result.summary.count/100))}</span><Button variant="outline" disabled={busy || (result.page+1)*100>=result.result.summary.count} onClick={()=>void run(result.page+1,result.query)}>{text('التالي','Next')}</Button></div>
  </>}
 </section>;
}
