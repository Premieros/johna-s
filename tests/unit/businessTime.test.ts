import { describe, expect, it } from 'vitest';
import { reportDateRangeUtc } from '@/lib/businessTime';

describe('reportDateRangeUtc', () => {
  it('uses Cairo daylight-saving offset for September business dates', () => {
    expect(reportDateRangeUtc('2026-09-18', '2026-09-18')).toEqual({
      startIso: '2026-09-17T21:00:00.000Z',
      endExclusiveIso: '2026-09-18T21:00:00.000Z',
    });
  });

  it('uses Cairo standard-time offset for January business dates', () => {
    expect(reportDateRangeUtc('2026-01-10', '2026-01-10')).toEqual({
      startIso: '2026-01-09T22:00:00.000Z',
      endExclusiveIso: '2026-01-10T22:00:00.000Z',
    });
  });

  it('keeps multi-day ranges end-exclusive at the next Cairo midnight', () => {
    const range = reportDateRangeUtc('2026-09-17', '2026-09-19');
    expect(range.startIso).toBe('2026-09-16T21:00:00.000Z');
    expect(range.endExclusiveIso).toBe('2026-09-19T21:00:00.000Z');
  });
});
