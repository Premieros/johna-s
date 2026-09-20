import { describe, expect, it } from 'vitest';
import { reportDateRangeUtc } from '@/lib/businessTime';
import { clampHistoryRange, historyCutoffDate, historyCutoffIso } from '@/lib/useHistoryAccess';

describe('historical data access', () => {
  const now = new Date('2026-09-20T15:00:00.000Z');

  it('anchors limited history to the latest seven Cairo calendar days', () => {
    expect(historyCutoffDate(now)).toBe('2026-09-14');
    expect(historyCutoffIso(now)).toBe(reportDateRangeUtc('2026-09-14', '2026-09-14').startIso);

    expect(clampHistoryRange('2026-08-01', '2026-09-20', false, now)).toEqual({
      from: '2026-09-14',
      to: '2026-09-20',
      clamped: true,
    });
  });

  it('uses Cairo business date across the UTC midnight boundary', () => {
    const cairoAfterMidnight = new Date('2026-09-19T22:30:00.000Z');
    expect(historyCutoffDate(cairoAfterMidnight)).toBe('2026-09-14');
    expect(clampHistoryRange(null, null, false, cairoAfterMidnight)).toEqual({
      from: '2026-09-14',
      to: '2026-09-20',
      clamped: false,
    });
  });

  it('does not allow moving a limited seven-day window into older history', () => {
    expect(clampHistoryRange('2026-01-01', '2026-01-07', false, now)).toEqual({
      from: '2026-09-14',
      to: '2026-09-14',
      clamped: true,
    });
  });

  it('leaves dates unrestricted when the capability is granted', () => {
    expect(clampHistoryRange('2025-01-01', '2025-12-31', true, now)).toEqual({
      from: '2025-01-01',
      to: '2025-12-31',
      clamped: false,
    });
  });
});
