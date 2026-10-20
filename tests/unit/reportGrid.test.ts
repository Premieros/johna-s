import {describe,expect,it} from 'vitest';
import {primaryReportColumn} from '@/features/reporting/reportGrid';
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
