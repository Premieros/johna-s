import { addIsoDays, businessDateISO, reportDateRangeUtc } from '@/lib/businessTime';

export type DashboardRange = 'today' | 'week' | 'month' | 'previous_month' | 'year' | 'custom';
export type DashboardDates = { from: string; to: string };

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}

export function dashboardPeriod(range: DashboardRange, custom: DashboardDates, now = new Date()) {
  const today = businessDateISO(now);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const monthStart = `${today.slice(0, 7)}-01`;
  const previousMonthStart = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10);
  let from = today;
  let to = today;
  if (range === 'week') from = addIsoDays(today, -6);
  if (range === 'month') from = monthStart;
  if (range === 'previous_month') { from = previousMonthStart; to = addIsoDays(monthStart, -1); }
  if (range === 'year') from = `${year}-01-01`;
  if (range === 'custom') {
    if (!validDate(custom.from) || !validDate(custom.to) || custom.from > custom.to) throw new Error('INVALID_DATE_RANGE');
    from = custom.from; to = custom.to;
  }
  const dayCount = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  let previousFrom = addIsoDays(from, -dayCount);
  let previousTo = addIsoDays(from, -1);
  if (range === 'month' || range === 'previous_month') {
    previousFrom = new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 2, 1)).toISOString().slice(0, 10);
    const last = addIsoDays(from, -1);
    previousTo = range === 'previous_month' ? last : addIsoDays(previousFrom, Math.min(dayCount, Number(last.slice(8))) - 1);
  }
  if (range === 'year') {
    previousFrom = `${year - 1}-01-01`;
    const lastDay = new Date(Date.UTC(year - 1, month, 0)).getUTCDate();
    previousTo = `${year - 1}-${today.slice(5, 7)}-${String(Math.min(Number(today.slice(8)), lastDay)).padStart(2, '0')}`;
  }
  const current = reportDateRangeUtc(from, to);
  const previous = reportDateRangeUtc(previousFrom, previousTo);
  const end = new Date(Date.parse(current.endExclusiveIso) - 1);
  const previousEnd = new Date(Date.parse(previous.endExclusiveIso) - 1);
  return { from, to, previousFrom, previousTo, dayCount,
    start: new Date(current.startIso), end,
    previousStart: new Date(previous.startIso), previousEnd };
}
