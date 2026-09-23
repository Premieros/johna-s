import { useMemo } from 'react';
import { useCan } from '@/lib/permissions';

export const LIMITED_HISTORY_DAYS = 7;

/**
 * The recent window is shown in full, but it is not a hard maximum range.
 * Older rows are sampled by the database visibility policies.
 */
export function clampHistoryRange(
  from: string | null | undefined,
  to: string | null | undefined,
  unlimited: boolean,
): { from: string; to: string; clamped: boolean } {
  void unlimited;
  return {
    from: from || '',
    to: to || '',
    clamped: false,
  };
}

export function useHistoryAccess() {
  const can = useCan();
  const unlimited = can('history.unlimited');

  return useMemo(() => ({
    unlimited,
    recentFullDays: LIMITED_HISTORY_DAYS,
    maxDays: null,
    minDate: undefined,
    minIso: undefined,
    clampRange: (from?: string | null, to?: string | null) => clampHistoryRange(from, to, unlimited),
  }), [unlimited]);
}
