import { useMemo } from 'react';
import { useCan } from '@/lib/permissions';

export const LIMITED_HISTORY_DAYS = 7;

export function historyCutoffDate(now = new Date()): string {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (LIMITED_HISTORY_DAYS - 1));
  return d.toISOString().slice(0, 10);
}

export function historyCutoffIso(now = new Date()): string {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (LIMITED_HISTORY_DAYS - 1));
  return d.toISOString();
}

export function clampHistoryRange(
  from: string | null | undefined,
  to: string | null | undefined,
  unlimited: boolean,
  now = new Date(),
): { from: string; to: string; clamped: boolean } {
  const today = now.toISOString().slice(0, 10);
  const targetTo = to || today;
  if (unlimited) return { from: from || '', to: targetTo, clamped: false };

  const cutoff = historyCutoffDate(new Date(`${targetTo}T12:00:00Z`));
  const requestedFrom = from || cutoff;
  return {
    from: requestedFrom < cutoff ? cutoff : requestedFrom,
    to: targetTo,
    clamped: requestedFrom < cutoff,
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
