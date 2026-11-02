export type EmployeeReceivablePeriod = {
  from: string;
  to: string;
};

export const getCairoToday = (now = new Date()): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function getEmployeeReceivableMinimumDate(
  today: string,
  openingDate: string,
  historyUnlimited: boolean,
): string {
  if (historyUnlimited) return openingDate;
  const recentWindowStart = addDays(today, -6);
  return recentWindowStart > openingDate ? recentWindowStart : openingDate;
}

export function createCurrentMonthEmployeeReceivablePeriod(
  today: string,
  minimumDate: string,
): EmployeeReceivablePeriod {
  const monthStart = `${today.slice(0, 7)}-01`;
  return {
    from: monthStart > minimumDate ? monthStart : minimumDate,
    to: today,
  };
}

export function isValidEmployeeReceivablePeriod(
  period: EmployeeReceivablePeriod,
  minimumDate: string,
  today: string,
): boolean {
  return Boolean(
    period.from && period.to
    && period.from >= minimumDate
    && period.from <= period.to
    && period.to <= today,
  );
}
