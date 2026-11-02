export type EmployeeReceivablePeriod = {
  from: string;
  to: string;
};

export type EmployeeReceivableStatementRow = {
  id: string;
  occurred_at: string;
  kind: 'opening' | 'sale' | 'payment' | 'adjustment';
  reference: string | null;
  description: string;
  source: string | null;
  debit: number;
  credit: number;
  balance: number;
};

export type EmployeeReceivablePeriodResult = {
  rows: EmployeeReceivableStatementRow[];
  openingBalance: number;
  debit: number;
  credit: number;
  closingBalance: number;
};

const roundMoney = (value: number) => Number(value.toFixed(2));

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function getCairoToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
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

export function buildEmployeeReceivablePeriod(
  allRows: EmployeeReceivableStatementRow[],
  period: EmployeeReceivablePeriod,
  openingDescription = 'Opening balance at period start',
  openingSource = 'Opening balance',
): EmployeeReceivablePeriodResult {
  const openingSourceRow = allRows.find((row) => row.kind === 'opening');
  const baseOpening = Number(openingSourceRow?.balance || 0);
  // The canonical party-statement RPC already returns movements in its
  // accounting order (date, entry number, line ID). Keep that order exactly;
  // sorting by display IDs here could reorder same-day entries.
  const movements = allRows.filter((row) => row.kind !== 'opening');

  const beforePeriod = movements.filter((row) => row.occurred_at.slice(0, 10) < period.from);
  const periodMovements = movements.filter((row) => {
    const date = row.occurred_at.slice(0, 10);
    return date >= period.from && date <= period.to;
  });

  const openingBalance = roundMoney(baseOpening + beforePeriod.reduce(
    (sum, row) => sum + Number(row.debit || 0) - Number(row.credit || 0),
    0,
  ));
  const debit = roundMoney(periodMovements.reduce((sum, row) => sum + Number(row.debit || 0), 0));
  const credit = roundMoney(periodMovements.reduce((sum, row) => sum + Number(row.credit || 0), 0));

  let runningBalance = openingBalance;
  const rows: EmployeeReceivableStatementRow[] = [{
    id: `period-opening-${period.from}`,
    occurred_at: `${period.from}T12:00:00+03:00`,
    kind: 'opening',
    reference: null,
    description: openingDescription,
    source: openingSource,
    debit: 0,
    credit: 0,
    balance: openingBalance,
  }];

  for (const row of periodMovements) {
    runningBalance = roundMoney(runningBalance + Number(row.debit || 0) - Number(row.credit || 0));
    rows.push({ ...row, balance: runningBalance });
  }

  return {
    rows,
    openingBalance,
    debit,
    credit,
    closingBalance: roundMoney(openingBalance + debit - credit),
  };
}
