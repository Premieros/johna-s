import {describe,expect,it} from 'vitest';
import { analysisColumns } from '@/features/reporting/reportDataContracts';
import {additiveReportTotals,primaryReportColumn} from '@/features/reporting/reportGrid';
describe('report primary identifier',()=>{
 it('freezes descriptions ahead of dates and numeric columns in both languages',()=>{
  expect(primaryReportColumn(['التاريخ','المبلغ','الخامة'])).toBe('الخامة');
  expect(primaryReportColumn(['Date','Total','Product'])).toBe('Product');
 });
 it('falls back to a visible identifier when the description is hidden',()=>{
  expect(primaryReportColumn(['Invoice','Date','Total'])).toBe('Invoice');
  expect(primaryReportColumn(['Code','Balance'])).toBe('Code');
  expect(primaryReportColumn([])).toBeUndefined();
 });
});

describe('aligned additive report totals',()=>{
 it('uses complete metrics for a small server page and never substitutes the visible-page sum',()=>{
  const columns=analysisColumns('sales',[{'Invoice':'one','Net Sales':10,'Paid':8,'Unit Price':4,'Net Quantity':2}]);
  expect(additiveReportTotals(columns,[{'Net Sales':10,'Paid':8}],false,{'Net Sales':2050,'Paid':1230})).toEqual({'Net Sales':2050,'Paid':1230});
  expect(additiveReportTotals(columns,[{'Net Sales':10,'Paid':8}],false,{})).toEqual({'Net Sales':null,'Paid':null});
 });
 it('sums complete bilingual material amounts, excluding quantities, prices and repeated invoice counts',()=>{
  const rows=[{'الخامة':'أ','صافي قيمة البنود':90,'سعر الوحدة':2,'صافي الكمية':45,'فواتير تتضمن الصنف':1},{'الخامة':'ب','صافي قيمة البنود':20,'سعر الوحدة':5,'صافي الكمية':4,'فواتير تتضمن الصنف':1}];
  expect(additiveReportTotals(analysisColumns('purchases',rows),rows,true)).toEqual({'صافي قيمة البنود':110});
 });
 it('does not add invoice counts across split payment methods',()=>{
  const rows=[{'Payment method':'cash','Net Sales':20,'Invoices':1},{'Payment method':'card','Net Sales':30,'Invoices':1}];
  expect(additiveReportTotals(analysisColumns('sales_by_payment',rows),rows,true)).toEqual({'Net Sales':50});
 });
 it('keeps incomplete costs unavailable instead of summing only the priced rows',()=>{
  const rows=[{'Recorded Cost':10},{'Recorded Cost':null}];
  expect(additiveReportTotals(analysisColumns('sales_costs',rows),rows,true)).toEqual({'Recorded Cost':null});
 });
});
