import { describe, expect, it } from 'vitest';
import { moveReportColumn, orderReportColumns } from '@/features/reporting/reportColumnLayout';
describe('report column order', () => {
  it('keeps saved order without deleted/duplicate columns and appends newly available columns', () => {
    expect(orderReportColumns(['Branch', 'Invoice', 'Tax', 'Net'], ['Net', 'deleted', 'Net', 'Invoice'])).toEqual(['Net', 'Invoice', 'Branch', 'Tax']);
  });
  it('moves a column without modifying visibility or the supplied arrays', () => {
    const columns = ['Branch', 'Invoice', 'Net'];
    expect(moveReportColumn(columns, undefined, 'Net', -1)).toEqual(['Branch', 'Net', 'Invoice']);
    expect(columns).toEqual(['Branch', 'Invoice', 'Net']);
    expect(moveReportColumn(columns, undefined, 'Branch', -1)).toEqual(columns);
    expect(moveReportColumn(columns, undefined, 'missing', 1)).toEqual(columns);
  });
});
