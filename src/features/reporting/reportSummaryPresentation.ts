import type { ReportType } from './reportFilters';

/** Labels describe the existing authoritative metric; they never recalculate it. */
export function reportSummaryPresentation(type: ReportType, lang: 'ar'|'en') {
  const text=(ar:string,en:string)=>lang==='ar'?ar:en;
  const netSales=text('صافي المبيعات','Net sales');
  const labels: Partial<Record<ReportType,string>>={
    sales:netSales,sales_by_product:netSales,sales_by_station:netSales,sales_by_employee:netSales,
    cashier_performance:netSales,detailed_invoices:netSales,daily_closing_range:netSales,
    financial_reconciliation:netSales,raw_material_financial:netSales,
    purchases:text('صافي المشتريات','Net purchases'),expenses:text('المصروفات المرحلة','Posted expenses'),
    profit:text('صافي الربح المحاسبي','Accounting net profit'),returns:text('قيمة المرتجعات','Refund value'),
    sales_costs:text('صافي الإيراد دون الضريبة','Net revenue excluding tax'),
    sales_by_payment:text('إجمالي التوزيع حسب طريقة الدفع','Payment-method allocation total'),
    raw_material_valuation:text('قيمة المخزون المحاسبية','Accounting inventory value'),
    inventory_as_of:text('القيمة المسجلة بنهاية اليوم','Recorded end-of-day value'),
    raw_material_consumption:text('قيمة الاستهلاك المسجلة','Recorded consumption value'),
    sales_component_reconciliation:text('قيمة الاستهلاك النظري','Theoretical consumption value'),
    production_waste:text('قيمة الهالك المسجلة','Recorded waste value'),
    component_consumption:text('قيمة الاستهلاك','Consumption value'),
  };
  const label=labels[type];
  const countLabel=type==='sales_component_reconciliation'?text('خامات ذات فروق','Materials with differences')
    :type==='financial_reconciliation'?text('عدد الفروق','Mismatch count'):text('العدد','Count');
  let basis='';
  if(['raw_material_consumption','raw_material_financial','raw_material_valuation','inventory_as_of','sales_component_reconciliation'].includes(type)) basis=text('قيم مسجلة في الحركات؛ تختلف عن إعادة التقييم بآخر سعر.','Recorded movement values; distinct from revaluation at the latest price.');
  if(type==='sales_costs'||type==='sales_by_station') basis=text('التكلفة المسجلة وقت العملية تختلف عن إعادة التقييم بالسعر الحالي؛ راجع اسم كل عمود.','Cost recorded at the operation differs from current-price revaluation; check each column label.');
  if(type==='sales_by_payment') basis=text('التوزيع قد يشمل الآجل؛ لا يمثل كله نقدية محصلة أو حركة الخزنة.','Allocation may include credit; it is not all collected cash or treasury movement.');
  return {label:label||'',showTotal:!!label,countLabel,basis};
}

/** Branch summaries belong in their own panel/export summary, never detail rows. */
export function flattenReportSummaries(rows: Record<string,unknown>[]): Record<string,unknown> {
  return Object.fromEntries(rows.flatMap((row,index)=>{
    const branch=String(row['الفرع']??row.Branch??'');
    return Object.entries(row).filter(([key,value])=>
      key!=='الفرع'&&key!=='Branch'&&key!=='الخامة'&&key!=='Raw Material'
      &&!key.includes('كمية')&&!key.includes('Qty')&&value!=null&&value!==''
    ).map(([key,value])=>[`${index+1}. ${branch} · ${key}`,value]);
  }));
}
