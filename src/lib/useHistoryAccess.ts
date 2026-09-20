import { useMemo } from 'react';
import { useCan } from '@/lib/permissions';
import { addIsoDays, businessDateISO, reportDateRangeUtc } from '@/lib/businessTime';

export const LIMITED_HISTORY_DAYS = 7;

export function historyCutoffDate(now = new Date()): string {
  return addIsoDays(businessDateISO(now), -(LIMITED_HISTORY_DAYS - 1));
}

export function historyCutoffIso(now = new Date()): string {
  const cutoff = historyCutoffDate(now);
  return reportDateRangeUtc(cutoff, cutoff).startIso;
}

export function clampHistoryRange(
  from: string | null | undefined,
  to: string | null | undefined,
  unlimited: boolean,
  now = new Date(),
): { from: string; to: string; clamped: boolean } {
  const today = businessDateISO(now);
  const requestedTo = to || today;
  if (unlimited) return { from: from || '', to: requestedTo, clamped: false };

  const cutoff = historyCutoffDate(now);
  const targetTo = requestedTo < cutoff ? cutoff : requestedTo;
  const requestedFrom = from || cutoff;
  const targetFrom = requestedFrom < cutoff ? cutoff : requestedFrom;
  return {
    from: targetFrom > targetTo ? targetTo : targetFrom,
    to: targetTo,
    clamped: requestedFrom < cutoff || requestedTo < cutoff || targetFrom > targetTo,
  };
}

export function useHistoryAccess() {
  const can = useCan();
  const unlimited = can('history.unlimited');
  return useMemo(() => ({
    unlimited,
    maxDays: unlimited ? null : LIMITED_HISTORY_DAYS,
    minDate: unlimited ? undefined : historyCutoffDate(),
    minIso: unlimited ? undefined : historyCutoffIso(),
    clampRange: (from?: string | null, to?: string | null) => clampHistoryRange(from, to, unlimited),
  }), [unlimited]);
}
