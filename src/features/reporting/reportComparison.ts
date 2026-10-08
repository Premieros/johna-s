export interface ComparisonPeriod { from: string; to: string; }
const iso = (date: Date) => date.toISOString().slice(0, 10);
export function comparisonPeriod(current: ComparisonPeriod, mode: 'previous' | 'year'): ComparisonPeriod {
  const start = new Date(`${current.from}T00:00:00Z`); const end = new Date(`${current.to}T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) throw new Error('INVALID_COMPARISON_PERIOD');
  if (mode === 'previous') {
    const length = end.getTime() - start.getTime() + 86400000;
    return { from: iso(new Date(start.getTime() - length)), to: iso(new Date(start.getTime() - 86400000)) };
  }
  const previousYear = (date: Date) => {
    const year = date.getUTCFullYear() - 1; const month = date.getUTCMonth();
    const day = Math.min(date.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
    return iso(new Date(Date.UTC(year, month, day)));
  };
  return { from: previousYear(start), to: previousYear(end) };
}
