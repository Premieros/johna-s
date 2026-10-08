import { describe, expect, it } from 'vitest';
import { requireReportData } from '@/features/reporting/services/reportResult';
describe('complete report-source results', () => {
  it('accepts a valid empty report but rejects source and embedded failures', () => {
    expect(requireReportData({ data: [], error: null })).toEqual([]);
    expect(() => requireReportData({ data: null, error: { message: 'FAILED_BRANCH' } })).toThrow('FAILED_BRANCH');
    expect(() => requireReportData({ data: { success: false, error: 'DENIED' }, error: null })).toThrow('DENIED');
    expect(() => requireReportData({ data: null, error: null })).toThrow('REPORT_SOURCE_INVALID');
  });
  it('rejects an otherwise successful result after its scope is aborted', () => {
    const controller = new AbortController(); controller.abort();
    expect(() => requireReportData({ data: [{ id: 'old' }], error: null }, controller.signal)).toThrow();
  });
});
