import type { Language } from '@/lib/types';

/** Report dates use Gregorian day/month/year; timestamps follow the business timezone. */
export function formatReportDate(value: string | Date, lang: Language = 'ar'): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-');
    return `${day}/${month}/${year}`;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return date.toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', {
    calendar: 'gregory', numberingSystem: 'latn', timeZone: 'Africa/Cairo',
    day: '2-digit', month: '2-digit', year: 'numeric',
  }).replace(/[\u200e\u200f]/g, '');
}

export function formatReportTimestamp(value: string, lang: Language = 'ar'): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return `${formatReportDate(date, lang)} ${date.toLocaleTimeString('en-GB', { timeZone: 'Africa/Cairo', hour12: false })}`;
}
