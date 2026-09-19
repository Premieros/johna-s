export const BUSINESS_TIME_ZONE = 'Africa/Cairo';

type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const cairoFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function parseIsoDate(date: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Invalid ISO date: ${date}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function partsAt(date: Date): DateParts {
  const parts = cairoFormatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value || 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

function cairoLocalDateTimeToUtc(date: string, hour = 0, minute = 0, second = 0): Date {
  const target = parseIsoDate(date);
  const targetAsUtc = Date.UTC(target.year, target.month - 1, target.day, hour, minute, second);
  let guessMs = targetAsUtc;

  // Iterating makes the conversion correct across Cairo DST changes without
  // hard-coding +02/+03 offsets.
  for (let i = 0; i < 3; i += 1) {
    const actual = partsAt(new Date(guessMs));
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    const delta = targetAsUtc - actualAsUtc;
    guessMs += delta;
    if (delta === 0) break;
  }
  return new Date(guessMs);
}

export function addIsoDays(date: string, days: number): string {
  const { year, month, day } = parseIsoDate(date);
  const shifted = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return shifted.toISOString().slice(0, 10);
}

export function reportDateRangeUtc(from: string, to: string): { startIso: string; endExclusiveIso: string } {
  return {
    startIso: cairoLocalDateTimeToUtc(from, 0, 0, 0).toISOString(),
    endExclusiveIso: cairoLocalDateTimeToUtc(addIsoDays(to, 1), 0, 0, 0).toISOString(),
  };
}
