import { useLayoutEffect, useRef, useState } from 'react';
import { reporting } from '@/api';
import type { ConsumptionPurchaseResult, ConsumptionPurchaseRow } from '@/api/domains/reporting';
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

type Query = { from: string; to: string; group: 'material' | 'product'; search: string; waste: boolean };
type Snapshot = { scope: string; query: Query; page: number; result: ConsumptionPurchaseResult };
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
 const [query,setQuery] = useState<Query>(() => ({ from: validDate(params.get('from')), to: validDate(params.get('to')), group: 'material', search: '', waste: false }));
 const [snapshot,setSnapshot] = useState<Snapshot | null>(null);
 const [busy,setBusy] = useState(false); const [error,setError] = useState<unknown>(null);
 const pending = useRef<AbortController | null>(null);
 const { visibleColumns,toggleColumn,showAllColumns,columnOrder,moveColumn,resetColumnOrder } = useColumnPreferences(`consumption_purchase_v1_${lang}`);
 useLayoutEffect(() => { pending.current?.abort(); setSnapshot(null); setError(null); setBusy(false); return () => pending.current?.abort(); },[scope]);
 const result = snapshot?.scope === scope ? snapshot : null;
 const text = (arabic: string,english: string) => ar ? arabic : english;
 const edit = (change: Partial<Query>) => setQuery(previous => ({ ...previous,...change }));
 const dirty = !!result && JSON.stringify(query)!==JSON.stringify(result.query);
 const labels = {
  branch_name: text('الفرع','Branch'),product_name: text('المنتج','Product'),raw_material_name: text('الخامة','Material'),raw_material_code: text('الكود','Code'),
  unit_name: text('الوحدة','Unit'),consumed_quantity: text('المستهلك قبل الإرجاع','Gross consumption'),returned_quantity: text('الكمية المعادة','Returned quantity'),
  waste_quantity: text('الهالك المضاف','Included waste'),net_quantity: text('صافي الاستهلاك','Net consumption'),last_purchase_price: text('آخر سعر شراء / وحدة','Last purchase / unit'),
  price_date: text('تاريخ سعر الشراء','Purchase price date'),purchase_reference: text('مرجع الشراء','Purchase reference'),consumption_value: text('قيمة الاستهلاك','Consumption value'),
 };
 const keys = (Object.keys(labels) as Array<keyof typeof labels>).filter(key => (key!=='product_name' || result?.query.group==='product') && (key!=='waste_quantity' || result?.query.waste));
 const columns = orderReportColumns(keys.map(key => labels[key]),columnOrder).filter(key => !visibleColumns || visibleColumns.includes(key));
 const number = (value: number) => new Intl.NumberFormat(lang,{ maximumFractionDigits:6 }).format(value);
 const value = (row: ConsumptionPurchaseRow,key: keyof typeof labels): string | number => {
  if (key==='product_name') return row.product_name || text('غير منسوب إلى منتج','Unattributed');
  if ((key==='last_purchase_price' || key==='consumption_value') && row.price_missing) return text('بلا سعر شراء','No purchase price');
  if (key==='price_date') return row.price_date ? new Date(row.price_date).toLocaleString(lang,{ timeZone:'Africa/Cairo' }) : '—';
  return row[key] ?? '—';
 };
 const records = (rows: ConsumptionPurchaseRow[]) => rows.map(row => Object.fromEntries(keys.filter(key => columns.includes(labels[key])).map(key => [labels[key],value(row,key)])));
 async function fetchPage(q: Query,page: number,size: number,signal: AbortSignal) {
  const dates = history.clampRange(q.from,q.to);
  if (!dates.from || !dates.to || dates.from>dates.to) throw new Error(text('حدد فترة صحيحة','Select a valid period'));
  const response = await reporting.getConsumptionPurchaseReport({ p_branch_id:branch || null,p_from_date:dates.from,p_to_date:dates.to,
   p_group_by:q.group,p_search:q.search.trim(),p_include_waste:q.waste,p_page:page,p_page_size:size },signal);
  signal.throwIfAborted(); if (response.error) throw response.error;
  if (!response.data || !Array.isArray(response.data.rows) || !response.data.summary || response.data.pricing_basis!=='latest_completed_purchase') throw new Error('REPORT_SOURCE_INVALID');
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
   const rows: ConsumptionPurchaseRow[]=[];
   for(let page=0;rows.length<result.result.summary.count;page++) {
    const data=await fetchPage(result.query,page,500,controller.signal);
    if(JSON.stringify(data.summary)!==JSON.stringify(result.result.summary) || !data.rows.length) throw new Error(text('تغيرت البيانات؛ أعد عرض التقرير قبل التصدير','Data changed; refresh before exporting'));
    rows.push(...data.rows);
   }
   if(liveScope.current!==requestScope || controller.signal.aborted) { win?.close();return; }
   const output=records(rows);
   const note=`${result.query.from} — ${result.query.to} · ${text('صافي الاستهلاك × آخر سعر شراء متاح وقت الاستخراج؛ إجمالي المسعّر فقط','Net consumption × latest purchase at extraction; priced subtotal only')}`;
   const title=text('استهلاك الخامات بآخر سعر شراء','Consumption at last purchase price');
   const totalLabel=text(result.result.summary.complete?'إجمالي قيمة الاستهلاك':'إجمالي المسعّر فقط',result.result.summary.complete?'Total consumption value':'Priced subtotal only');
   const missingLabel=text('صفوف بلا سعر شراء','Rows without a purchase price');
   if(kind==='excel') await exportToExcelAdvanced({data:output,columns,filename:'consumption_purchase',sheetName:'Consumption',title,subtitle:`${result.query.from} — ${result.query.to} · ${currency}`,totalRow:{[totalLabel]:result.result.summary.total,[missingLabel]:result.result.summary.unpriced_count},currencyColumns:[labels.last_purchase_price,labels.consumption_value],sourceNote:note,lang});
   else openPrintWindow({title,subtitle:`${note} · ${totalLabel}: ${number(result.result.summary.total)} ${currency} · ${missingLabel}: ${result.result.summary.unpriced_count}`,headers:columns,rows:output.map(row=>columns.map(key=>String(row[key]??''))),lang},win);
  } catch(failure) { win?.close();if(!controller.signal.aborted && liveScope.current===requestScope) setError(failure); }
  finally { if(pending.current===controller && liveScope.current===requestScope)setBusy(false); }
 }
 if(!allowed) return <p role="alert">{text('ليس لديك صلاحية عرض تكلفة الاستهلاك','Consumption costing permission is required')}</p>;
 return <section data-testid="purchase-consumption-report" className="space-y-3">
  <p className="rounded-lg border border-ui-border bg-ui-page-alt p-3 text-sm">{text('صافي الكمية المسجلة خلال الفترة × آخر سعر شراء مكتمل متاح الآن، بعد تحويله لوحدة المخزون. تاريخ الفترة بتوقيت القاهرة. إعادة الاستخراج بعد شراء جديد قد تغيّر القيمة.','Net recorded quantity in the Cairo date range × the latest completed purchase, normalized to the stock unit. A later purchase can change a re-extracted value.')}</p>
  {!history.unlimited && <p role="status" className="text-sm text-ui-warning">{text('البيانات والإجماليات تخضع لصلاحية الاطلاع على التاريخ؛ يلزم التاريخ الكامل لمراجعة شهر كامل.','History visibility applies to rows and totals. Full history permission is needed for a complete month review.')}</p>}
  <form onSubmit={event=>{event.preventDefault();void run();}} className="flex flex-wrap items-end gap-3 rounded-xl border border-ui-border bg-ui-surface p-3">
   <label>{text('من','From')}<input aria-label={text('من','From')} type="date" value={query.from} onChange={event=>edit({from:event.target.value})} className="block rounded border border-ui-border bg-ui-surface p-2" /></label>
   <label>{text('إلى','To')}<input aria-label={text('إلى','To')} type="date" value={query.to} onChange={event=>edit({to:event.target.value})} className="block rounded border border-ui-border bg-ui-surface p-2" /></label>
   <label>{text('العرض حسب','Group by')}<select aria-label={text('العرض حسب','Group by')} value={query.group} onChange={event=>edit({group:event.target.value as Query['group']})} className="block rounded border border-ui-border bg-ui-surface p-2"><option value="material">{text('الخامة','Material')}</option><option value="product">{text('المنتج والخامة','Product and material')}</option></select></label>
   <label className="flex-1">{text('بحث بالخامة أو المنتج أو الكود','Material, product or code')}<input type="search" value={query.search} onChange={event=>edit({search:event.target.value})} className="block w-full min-w-40 rounded border border-ui-border bg-ui-surface p-2" /></label>
   <label><input type="checkbox" checked={query.waste} onChange={event=>edit({waste:event.target.checked})} /> {text('إضافة الهالك','Include waste')}</label>
   <Button type="submit" disabled={busy}>{busy?text('جارٍ التحميل…','Loading…'):text('عرض التقرير','Run report')}</Button>
  </form>
  {dirty && <p role="status">{text('تغيّرت الفلاتر؛ اضغط عرض التقرير لتطبيقها. النتيجة أدناه للفترة السابقة.','Filters changed. Run the report to apply them; results below use the previous selection.')}</p>}
  {!!error && <p role="alert" className="text-ui-danger">{userFacingErrorMessage(error,lang)}</p>}
  {result && <>
   <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
    <p>{result.query.from} — {result.query.to} · {text('عدد الصفوف','Rows')}: {result.result.summary.count} · <strong>{text(result.result.summary.complete?'إجمالي قيمة الاستهلاك':'إجمالي المسعّر فقط',result.result.summary.complete?'Total consumption value':'Priced subtotal only')}: {number(result.result.summary.total)} {currency}</strong></p>
    <div className="flex gap-2"><ColumnPicker columns={keys.map(key=>labels[key])} visibleColumns={visibleColumns} onToggle={key=>toggleColumn(key,keys.map(item=>labels[item]))} hiddenCount={keys.length-columns.length} onShowAll={showAllColumns} onMove={(key,direction)=>moveColumn(key,direction,keys.map(item=>labels[item]))} onResetOrder={resetColumnOrder} lang={lang} />
    {can('reports.export') && <Button variant="outline" disabled={busy || !columns.length} onClick={()=>void exportAll('excel')}>Excel</Button>}
    {can('reports.print') && <Button variant="outline" disabled={busy || !columns.length} onClick={()=>void exportAll('print')}>{text('طباعة / PDF','Print / PDF')}</Button>}</div>
   </div>
   {!result.result.summary.complete && <p role="alert" className="rounded bg-ui-warning-soft p-3">{text('القيمة غير مكتملة: صفوف بلا سعر شراء','Incomplete value: rows without a purchase price')}: {result.result.summary.unpriced_count}</p>}
   {result.result.summary.unattributed_count>0 && <p role="status">{text('توجد حركات بلا ارتباط موثوق بمنتج؛ تظهر تحت «غير منسوب إلى منتج» ولا توزع تخمينيًا.','Some movements cannot be attributed to a product and are shown as Unattributed.')}</p>}
   <div className="max-h-[65vh] overflow-auto rounded-lg border border-ui-border"><table className="w-full border-collapse text-sm"><thead className="sticky top-0 z-10 bg-ui-page-alt"><tr>{columns.map(key=><th key={key} className="whitespace-nowrap border-b border-ui-border px-3 py-3 text-start">{key}</th>)}</tr></thead><tbody>{records(result.result.rows).map((row,index)=><tr key={index} className="odd:bg-ui-surface even:bg-ui-page-alt hover:bg-ui-primary/5">{columns.map(key=><td key={key} className="whitespace-nowrap border-b border-ui-border px-3 py-2 tabular-nums">{typeof row[key]==='number'?number(row[key] as number):String(row[key])}</td>)}</tr>)}</tbody></table>{!result.result.rows.length && <p className="p-6 text-center">{text('لا توجد حركات في الفترة المختارة','No movements in this period')}</p>}</div>
   <div className="flex items-center justify-center gap-3"><Button variant="outline" disabled={busy || result.page===0} onClick={()=>void run(result.page-1,result.query)}>{text('السابق','Previous')}</Button><span>{result.page+1} / {Math.max(1,Math.ceil(result.result.summary.count/100))}</span><Button variant="outline" disabled={busy || (result.page+1)*100>=result.result.summary.count} onClick={()=>void run(result.page+1,result.query)}>{text('التالي','Next')}</Button></div>
  </>}
 </section>;
}
