import { useEffect, useState } from 'react';
import { reporting } from '@/api';
import type { ConsumptionLatestRow, PeriodCloseMovement } from '@/api/domains/reporting';
import { useLanguage } from '@/context/LanguageContext';
import { userFacingErrorMessage } from '@/lib/userFacingError';

export type EvidenceKind = 'purchase' | 'transfer' | 'all' | 'consumption';
export function PeriodCloseEvidence({ kind, material, branch, from, to, expected }: {
 kind: EvidenceKind; material?: string; branch: string; from: string; to: string; expected?: number | null;
}) {
 const { lang } = useLanguage(); const ar = lang === 'ar';
 const [page,setPage] = useState(0);
 const [state,setState] = useState<{page:number; rows?: Array<PeriodCloseMovement | ConsumptionLatestRow>; count?:number; total?:number; error?:string}>();
 const size=50;
 useEffect(()=>{
  const controller=new AbortController();
  const load=async()=>{
   if(kind==='consumption') {
    const response=await reporting.getSoldRecipeConsumptionReport({p_branch_id:branch,p_from_date:from,p_to_date:to,p_group_by:'material',p_search:'',p_page:page,p_page_size:size},controller.signal);
    if(response.error || !response.data) throw response.error || new Error('REPORT_SOURCE_INVALID');
    return {rows:response.data.rows,count:response.data.summary.count,total:response.data.summary.total};
   }
   const response=await reporting.getPeriodCloseRawMovements({p_branch_id:branch,p_from:from,p_to:to,p_kind:kind,p_material_id:material ?? null,p_page:page,p_page_size:size},controller.signal);
   if(response.error || !response.data) throw response.error || new Error('REPORT_SOURCE_INVALID');
   return response.data;
  };
  void load().then(data=>{if(!controller.signal.aborted) setState({page,...data});}).catch(error=>{if(!controller.signal.aborted) setState({page,error:userFacingErrorMessage(error,lang)});});
  return ()=>controller.abort();
 },[branch,from,to,kind,material,page,lang]);
 const current=state?.page===page ? state : undefined;
 if(!current) return <p role="status">{ar?'جارٍ تحميل الحركات…':'Loading evidence…'}</p>;
 if(current.error) return <p role="alert">{current.error}</p>;
 const format=new Intl.NumberFormat(lang,{maximumFractionDigits:4});
 const money=new Intl.NumberFormat(lang,{minimumFractionDigits:2,maximumFractionDigits:2});
 const recipe=kind==='consumption';
 const labels=recipe ? (ar?['الخامة','الوحدة','استهلاك قبل المرتجع','المرتجع','صافي الاستهلاك','آخر سعر','القيمة']:['Material','Unit','Gross consumption','Returned','Net consumption','Latest price','Value']) :
  (ar?['التاريخ والوقت','الخامة','المستند','نوع الحركة','المخزن','الكمية','آخر سعر','القيمة']:['Date and time','Material','Document','Movement','Warehouse','Quantity','Latest price','Value']);
 const movementLabels:Record<string,string>={purchase:'شراء',purchase_return:'مرتجع شراء',transfer_in:'تحويل وارد',transfer_out:'تحويل صادر',warehouse_transfer:'تحويل مخزني',sale:'بيع',refund:'مرتجع',kitchen_send:'إرسال مطبخ',kitchen_void:'إلغاء مطبخ',adjustment:'تسوية',stock_count:'جرد',waste:'هالك'};
 return <>
  {expected!=null && Math.abs((current.total??0)-expected)>0.01 && <p role="status">{ar?'تغيرت البيانات منذ عرض الملخص. أعد عرض التقرير لمطابقة الإجماليات.':'Data changed since the summary was loaded. Run the report again to reconcile totals.'}</p>}
  <div className="max-h-[65vh] overflow-auto"><table className="w-full text-sm">
   <thead className="sticky top-0 bg-ui-surface"><tr>{labels.map(label=><th className="p-2 text-start" key={label}>{label}</th>)}</tr></thead>
   <tbody>{current.rows?.map(row=>{
    if('consumption_value' in row) return <tr className="border-t border-ui-border" key={row.raw_material_id}>
     {[row.raw_material_name,row.unit_name,format.format(row.consumed_quantity),format.format(row.returned_quantity),format.format(row.net_quantity),money.format(row.unit_price),money.format(row.consumption_value)].map((v,i)=><td key={i} className="p-2">{v}</td>)}
    </tr>;
    return <tr className="border-t border-ui-border" key={row.id}>{[new Date(row.created_at).toLocaleString(lang,{timeZone:'Africa/Cairo'}),row.name,row.reference_number??'—',ar?(movementLabels[row.reference_type]??movementLabels[row.entry_type]??row.entry_type):row.entry_type,row.warehouse_name??'—',format.format(row.quantity),money.format(row.price),money.format(row.value)].map((v,i)=><td className="p-2" key={i}>{v}</td>)}</tr>;
   })}</tbody>
   <tfoot className="sticky bottom-0 bg-ui-surface font-bold"><tr><th colSpan={labels.length-1} className="p-2 text-start">{ar?'إجمالي الفترة — كل الصفحات':'Period total — all pages'}</th><td className="p-2">{money.format(current.total??0)}</td></tr></tfoot>
  </table></div>
  {!current.rows?.length && <p>{ar?'لا توجد حركات للفترة.':'No movements for this period.'}</p>}
  <div className="flex items-center gap-3 py-2"><button disabled={!page} type="button" onClick={()=>setPage(page-1)}>{ar?'السابق':'Previous'}</button><span>{page+1} / {Math.max(1,Math.ceil((current.count??0)/size))}</span><button disabled={(page+1)*size>=(current.count??0)} type="button" onClick={()=>setPage(page+1)}>{ar?'التالي':'Next'}</button></div>
 </>;
}
