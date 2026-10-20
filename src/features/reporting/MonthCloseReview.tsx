import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useHistoryAccess } from '@/lib/useHistoryAccess';
import { todayISO } from '@/lib/format';
import type { WorkspaceView } from './reportWorkspace';

const steps = [
 { key:'sales',ar:'راجع صافي المبيعات والخصومات والمرتجعات',en:'Review net sales, discounts and returns',noteAr:'طابق الفواتير مع التحصيل، وراجع الطلبات المفتوحة من شاشة الطلبات النشطة.',noteEn:'Reconcile invoices with collections and review open orders in Active Orders.' },
 { key:'financial_reconciliation',ar:'طابق النقدي والكارت والتحويل والآجل',en:'Reconcile cash, card, transfer and credit',noteAr:'راجع الفروق مع إغلاق الورديات والخزائن والبنوك.',noteEn:'Check differences against shift closes, treasuries and banks.' },
 { key:'purchases',ar:'راجع المشتريات والموردين',en:'Review purchases and suppliers',noteAr:'راجع المرتجعات والمدفوع والمتبقي وكشوف الموردين.',noteEn:'Review returns, paid amounts, outstanding balances and supplier statements.' },
 { key:'expenses',ar:'راجع المصروفات',en:'Review expenses',noteAr:'راجع التصنيف والحالة والمستندات المؤيدة.',noteEn:'Check categories, posting status and supporting documents.' },
 { key:'component_consumption',ar:'راجع الاستهلاك والخامات بلا سعر شراء',en:'Review consumption and missing purchase prices',noteAr:'القيمة هنا بآخر شراء وقت الاستخراج؛ راجع الهالك والحركات غير المنسوبة لمنتج.',noteEn:'Value uses the latest purchase at extraction. Review waste and unattributed movements.' },
 { key:'raw_material_consumption',ar:'طابق أرصدة وحركة المخزون',en:'Reconcile inventory balances and movements',noteAr:'أول المدة + الوارد − الصادر ± التسويات = آخر المدة. راجع الجرد والأرصدة السالبة.',noteEn:'Opening + receipts − issues ± adjustments = closing. Review counts and negative balances.' },
 { key:'financial:trial_balance',ar:'راجع ميزان المراجعة والقوائم المالية',en:'Review trial balance and financial statements',noteAr:'راجع توازن القيود والأرصدة وقائمة الدخل. هذه الخطوات لا ترحّل أو تقفل الشهر تلقائيًا.',noteEn:'Check balanced journals, balances and income statement. This checklist does not post or close the month.' },
];
export function MonthCloseReview({ views,onSelect }: { views: WorkspaceView[]; onSelect: (view: WorkspaceView,period?: {from:string;to:string})=>void }) {
 const {lang}=useLanguage();const ar=lang==='ar';const history=useHistoryAccess();
 const [month,setMonth]=useState(todayISO().slice(0,7));
 const valid=/^\d{4}-(0[1-9]|1[0-2])$/.test(month);
 const end=valid?new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate():0;
 const period={from:`${month}-01`,to:`${month}-${String(end).padStart(2,'0')}`};
 return <section className="space-y-3" data-testid="month-close-review">
  <div className="flex flex-wrap items-center gap-3"><label className="font-bold">{ar?'شهر المراجعة':'Review month'} <input type="month" value={month} onChange={event=>setMonth(event.target.value)} className="rounded border border-ui-border bg-ui-surface p-2" /></label><p className="text-sm text-ui-muted">{ar?'افتح كل تقرير للفترة نفسها وراجع نتائجه. هذه قائمة مراجعة، وليست شهادة باكتمال الإغلاق.':'Open each report for the same period and review its results. This is a checklist, not confirmation of a completed close.'}</p></div>
  {!history.unlimited && <p role="alert" className="rounded bg-ui-warning-soft p-3">{ar?'صلاحية التاريخ الحالي قد تحدّ من البيانات الظاهرة؛ يلزم الاطلاع الكامل على الشهر قبل اعتماده.':'Your history permission may limit visible data. Complete month visibility is required before approval.'}</p>}
  <table className="w-full text-sm"><thead className="bg-ui-page-alt"><tr><th className="p-3 text-start">{ar?'المراجعة المطلوبة':'Required review'}</th><th className="p-3 text-start">{ar?'ما الذي تراجعه؟':'What to check'}</th><th className="p-3">{ar?'التقرير':'Report'}</th></tr></thead><tbody>{steps.map(step=>{const view=views.find(item=>item.key===step.key);return <tr key={step.key} className="border-b border-ui-border odd:bg-ui-surface"><td className="p-3 font-bold">{ar?step.ar:step.en}</td><td className="p-3 text-ui-muted">{ar?step.noteAr:step.noteEn}</td><td className="p-3 text-center">{view?<button type="button" disabled={!valid} className="rounded border border-ui-border px-3 py-2 font-bold text-ui-primary disabled:opacity-50" onClick={()=>onSelect(view,period)}>{ar?'فتح التقرير':'Open report'}</button>:<span>{ar?'غير متاح لصلاحياتك':'Not permitted'}</span>}</td></tr>;})}</tbody></table>
 </section>;
}
