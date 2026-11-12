import { describe, expect, it } from 'vitest';
import { formatReportDate, formatReportTimestamp } from '@/features/reporting/reportDate';

describe('Gregorian report date presentation', () => {
  it('keeps date-only report boundaries independent of browser timezone', () => {
    expect(formatReportDate('2026-10-01')).toBe('01/10/2026');
    expect(formatReportDate('2026-10-31', 'en')).toBe('31/10/2026');
  });
  it('uses Cairo calendar day for real timestamps in both languages', () => {
    for (const lang of ['ar', 'en'] as const) {
      expect(formatReportDate('2026-10-24T23:30:00Z', lang)).toBe('25/10/2026');
      expect(formatReportTimestamp('2026-10-24T23:30:00Z', lang)).toContain('25/10/2026');
    }
  });
  it('distinguishes invalid or missing timestamps from a real date', () => {
    expect(formatReportDate('')).toBe('—');
    expect(formatReportTimestamp('invalid')).toBe('—');
  });
});
