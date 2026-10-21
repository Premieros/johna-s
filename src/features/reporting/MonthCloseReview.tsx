import { useLayoutEffect, useRef, useState } from 'react';
import { reporting } from '@/api';
import { useAuth } from '@/context/AuthContext';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useReportPermissionVersion } from '@/hooks/useReportPermissionVersion';
import { reportDateRangeUtc } from '@/lib/businessTime';
import { userFacingErrorMessage } from '@/lib/userFacingError';
import { useLanguage } from '@/context/LanguageContext';
import { useHistoryAccess } from '@/lib/useHistoryAccess';
import { todayISO } from '@/lib/format';
import type { WorkspaceView } from './reportWorkspace';

const steps = [
 { key:'sales',ar:'راجع صافي المبيعات والخصومات والمرتجعات',en:'Review net sales, discounts and returns',noteAr:'طابق الفواتير مع التحصيل، وراجع الطلبات المفتوحة من شاشة الطلبات النشطة.',noteEn:'Reconcile invoices with collections and review open orders in Active Orders.' },
 { key:'financial_reconciliation',ar:'طابق النقدي والكارت والتحويل والآجل',en:'Reconcile cash, card, transfer and credit',noteAr:'راجع الفروق مع إغلاق الورديات والخزائن والبنوك.',noteEn:'Check differences against shift closes, treasuries and banks.' },
 { key:'purchases',ar:'راجع المشتريات والموردين',en:'Review purchases and suppliers',noteAr:'راجع المرتجعات والمدفوع والمتبقي وكشوف الموردين.',noteEn:'Review returns, paid amounts, outstanding balances and supplier statements.' },
 { key:'expenses',ar:'راجع المصروفات',en:'Review expenses',noteAr:'راجع التصنيف والحالة والمستندات المؤيدة.',noteEn:'Check categories, posting status and supporting documents.' },
 { key:'component_consumption',ar:'راجع الاستهلاك والخامات المحسوبة بصفر',en:'Review consumption and zero-priced materials',noteAr:'القيمة بآخر سعر من شراء أو تسعير أو جرد؛ بلا سعر يُحسب بصفر. الوصفات الحالية لصافي المنتجات المباعة؛ راجع الحركات الفعلية في تقرير المخزون.',noteEn:'Value uses the latest approved price from any source, or zero if missing. Current recipes of net sold products; review actual movements in the inventory report.' },
 { key:'raw_material_consumption',ar:'طابق أرصدة وحركة المخزون',en:'Reconcile inventory balances and movements',noteAr:'أول المدة + الوارد − الصادر ± التسويات = آخر المدة. راجع الجرد والأرصدة السالبة.',noteEn:'Opening + receipts − issues ± adjustments = closing. Review counts and negative balances.' },
 { key:'financial:trial_balance',ar:'راجع ميزان المراجعة والقوائم المالية',en:'Review trial balance and financial statements',noteAr:'راجع توازن القيود والأرصدة وقائمة الدخل. هذه الخطوات لا ترحّل أو تقفل الشهر تلقائيًا.',noteEn:'Check balanced journals, balances and income statement. This checklist does not post or close the month.' },
];
export function MonthCloseReview({ views,onSelect }: { views: WorkspaceView[]; onSelect: (view: WorkspaceView,period?: {from:string;to:string})=>void }) {
 const {lang}=useLanguage();const ar=lang==='ar';const history=useHistoryAccess();
 const [month,setMonth]=useState(todayISO().slice(0,7));
 const {user}=useAuth();const branch=useBranchFilter();const permissions=useReportPermissionVersion();
 const canCost=views.some(view=>view.type==='component_consumption');
 const scope=JSON.stringify([user?.id,user?.role,branch,permissions,canCost,month,lang]);
 const active=useRef(scope);active.current=scope;const pending=useRef<AbortController|null>(null);
 const [busy,setBusy]=useState(false);
 const [summary,setSummary]=useState<{scope:string;rows:{ar:string;en:string;value:number|null;error?:unknown}[];unpriced:number}|null>(null);
 useLayoutEffect(()=>{pending.current?.abort();setSummary(null);setBusy(false);return()=>pending.current?.abort();},[scope]);
 const valid=/^\d{4}-(0[1-9]|1[0-2])$/.test(month);
 const end=valid?new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate():0;
 const period={from:`${month}-01`,to:`${month}-${String(end).padStart(2,'0')}`};
 async function loadSummary() {
  if(!valid || busy)return;
  pending.current?.abort();const controller=new AbortController();pending.current=controller;const requestScope=scope;setBusy(true);
  const {startIso,endExclusiveIso}=reportDateRangeUtc(period.from,period.to);
  const requests=(['sales','purchases','expenses'] as const).map(async type=>{
   const response=await reporting.getOperationalReportMetrics({p_report_type:type,p_branch_id:branch||null,p_from_date:period.from,p_to_date:period.to,p_filters:{},p_from_ts:startIso,p_to_exclusive_ts:endExclusiveIso},controller.signal);
   if(response.error)throw response.error;if(!response.data)throw new Error('REPORT_SOURCE_INVALID');return response.data;
  });
  const [sales,purchases,expenses,cost]=await Promise.allSettled([...requests,canCost?reporting.getSoldRecipeConsumptionReport({p_branch_id:branch||null,p_from_date:period.from,p_to_date:period.to,p_group_by:'material',p_search:'',p_page:0,p_page_size:1},controller.signal).then(response=>{if(response.error)throw response.error;if(!response.data?.summary||!Array.isArray(response.data.rows))throw new Error('REPORT_SOURCE_INVALID');return response.data;}):Promise.resolve(null)]);
  if(controller.signal.aborted||active.current!==requestScope)return;
  const metric=(result:typeof sales,key:string)=>{const value=result.status==='fulfilled'&&result.value?(result.value as Record<string,unknown>)[key]:null;return typeof value==='number'&&Number.isFinite(value)?value:null;};
  const rows=[
   {ar:'صافي مبيعات فواتير الشهر',en:'Net month-invoice sales',value:metric(sales,'Net Sales'),error:sales.status==='rejected'?sales.reason:undefined},
   {ar:'صافي تحصيل فواتير الشهر',en:'Net collection of month invoices',value:metric(sales,'Net Collection'),error:sales.status==='rejected'?sales.reason:undefined},
   {ar:'صافي المشتريات',en:'Net purchases',value:metric(purchases,'Net Purchases'),error:purchases.status==='rejected'?purchases.reason:undefined},
   {ar:'المصروفات المرحلة',en:'Posted expenses',value:metric(expenses,'Amount'),error:expenses.status==='rejected'?expenses.reason:undefined},
  ];
  const consumption=cost.status==='fulfilled'?cost.value as import('@/api/domains/reporting').ConsumptionLatestResult|null:null;
  if(canCost)rows.push({ar:'استهلاك الخامات بآخر سعر معتمد',en:'Consumption at latest approved price',value:consumption?.summary.total??null,error:cost.status==='rejected'?cost.reason:undefined});
  setSummary({scope:requestScope,rows,unpriced:consumption?.summary.unpriced_count??0});setBusy(false);
 }
 return <section className="space-y-3" data-testid="month-close-review">
  <div className="flex flex-wrap items-center gap-3"><label className="font-bold">{ar?'شهر المراجعة':'Review month'} <input type="month" value={month} onChange={event=>setMonth(event.target.value)} className="rounded border border-ui-border bg-ui-surface p-2" /></label><p className="text-sm text-ui-muted">{ar?'افتح كل تقرير للفترة نفسها وراجع نتائجه. هذه قائمة مراجعة، وليست شهادة باكتمال الإغلاق.':'Open each report for the same period and review its results. This is a checklist, not confirmation of a completed close.'}</p></div>
  {!history.unlimited && <p role="alert" className="rounded bg-ui-warning-soft p-3">{ar?'صلاحية التاريخ الحالي قد تحدّ من البيانات الظاهرة؛ يلزم الاطلاع الكامل على الشهر قبل اعتماده.':'Your history permission may limit visible data. Complete month visibility is required before approval.'}</p>}
  <button type="button" disabled={!valid||busy} onClick={()=>void loadSummary()} className="rounded bg-ui-primary px-4 py-2 font-bold text-ui-primary-fg disabled:opacity-50">{busy?(ar?'جارٍ تحميل الملخص…':'Loading summary…'):(ar?'عرض ملخص الشهر':'Show month summary')}</button>
  {summary?.scope===scope && <div className="overflow-auto rounded border border-ui-border"><p className="p-3 text-sm">{period.from} — {period.to} · {ar?'ملخص تشغيلي؛ تحصيل فواتير الشهر ليس كشف حركة الخزنة ولا يمثل ربحًا صافيًا.':'Operational summary: invoice collection is not the treasury movement statement or net profit.'}</p><table className="w-full text-sm"><tbody>{summary.rows.map(row=><tr key={row.en} className="border-t border-ui-border"><th className="p-3 text-start">{ar?row.ar:row.en}</th><td className="p-3 tabular-nums">{row.value===null?(ar?'غير متاح':'Unavailable'):new Intl.NumberFormat(lang,{maximumFractionDigits:2}).format(row.value)}{row.error!=null&&<p role="alert" className="text-ui-danger">{userFacingErrorMessage(row.error,lang)}</p>}</td></tr>)}</tbody></table>{summary.unpriced>0&&<p role="alert" className="p-3 text-ui-warning">{ar?'خامات بلا سعر محسوبة بصفر:':'Materials without prices counted as zero:'} {summary.unpriced}</p>}</div>}
  <table className="w-full text-sm"><thead className="bg-ui-page-alt"><tr><th className="p-3 text-start">{ar?'المراجعة المطلوبة':'Required review'}</th><th className="p-3 text-start">{ar?'ما الذي تراجعه؟':'What to check'}</th><th className="p-3">{ar?'التقرير':'Report'}</th></tr></thead><tbody>{steps.map(step=>{const view=views.find(item=>item.key===step.key);return <tr key={step.key} className="border-b border-ui-border odd:bg-ui-surface"><td className="p-3 font-bold">{ar?step.ar:step.en}</td><td className="p-3 text-ui-muted">{ar?step.noteAr:step.noteEn}</td><td className="p-3 text-center">{view?<button type="button" disabled={!valid} className="rounded border border-ui-border px-3 py-2 font-bold text-ui-primary disabled:opacity-50" onClick={()=>onSelect(view,period)}>{ar?'فتح التقرير':'Open report'}</button>:<span>{ar?'غير متاح لصلاحياتك':'Not permitted'}</span>}</td></tr>;})}</tbody></table>
 </section>;
}
