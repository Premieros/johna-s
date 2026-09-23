import { describe, expect, it } from 'vitest';
import { clampHistoryRange, LIMITED_HISTORY_DAYS } from '@/lib/useHistoryAccess';

describe('historical data access', () => {
  it('keeps seven days as the fully visible recent window', () => {
    expect(LIMITED_HISTORY_DAYS).toBe(7);
  });

  it('does not clamp older requested ranges for limited users', () => {
    expect(clampHistoryRange('2026-08-01', '2026-09-20', false)).toEqual({
      from: '2026-08-01',
      to: '2026-09-20',
      clamped: false,
    });
  });

  it('allows older custom periods because database sampling enforces visibility', () => {
    expect(clampHistoryRange('2026-01-01', '2026-01-31', false)).toEqual({
      from: '2026-01-01',
      to: '2026-01-31',
      clamped: false,
    });
  });

  it('also leaves dates unrestricted when full-history capability is granted', () => {
    expect(clampHistoryRange('2025-01-01', '2025-12-31', true)).toEqual({
      from: '2025-01-01',
      to: '2025-12-31',
      clamped: false,
    });
  });
});
