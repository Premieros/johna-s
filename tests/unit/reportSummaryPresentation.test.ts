import {describe,expect,it} from 'vitest';
import {flattenReportSummaries,reportSummaryPresentation} from '@/features/reporting/reportSummaryPresentation';
describe('report metric identity',()=>{
 it('does not present mixed-unit quantities or catalog/recipe prices as a money total',()=>{
  for(const type of ['inventory','low_stock','recipe_costs','raw_material_current_cost'] as const)expect(reportSummaryPresentation(type,'en').showTotal).toBe(false);
 });
 it('names the authoritative metric and distinguishes recorded and revalued costs',()=>{
  expect(reportSummaryPresentation('sales_costs','en').label).toBe('Net revenue excluding tax');
  expect(reportSummaryPresentation('raw_material_financial','en').label).toBe('Net sales');
  expect(reportSummaryPresentation('raw_material_consumption','en').basis).toContain('distinct from revaluation');
  expect(reportSummaryPresentation('sales_by_payment','en').basis).toContain('not all collected cash');
 });
 it('separates branch summaries from detail data and does not sum heterogeneous quantities',()=>{
  expect(flattenReportSummaries([{Branch:'A','Raw Material':'Period Total','Opening Value':20,'Theoretical Qty':1000},{Branch:'A','Raw Material':'Period Total','Opening Value':30}])).toEqual({'1. A · Opening Value':20,'2. A · Opening Value':30});
 });
});
