import type { Language } from './types';

const DISPLAY_LOCALE = 'en-US';
const ZERO_EPSILON = 0.0000001;

function numericOrZero(value: number | null | undefined): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function formatDisplayNumber(
  value: number | null | undefined,
  maximumFractionDigits = 1,
): string {
  const numeric = numericOrZero(value);
  if (Math.abs(numeric) < ZERO_EPSILON) return '-';
  return numeric.toLocaleString(DISPLAY_LOCALE, {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  });
}

export function formatCurrency(
  amount: number | null | undefined,
  currency = 'EGP',
  lang: Language = 'ar',
): string {
  const numeric = numericOrZero(amount);
  if (Math.abs(numeric) < ZERO_EPSILON) return '-';

  const symbolMap: Record<string, { ar: string; en: string }> = {
    EGP: { ar: 'ج.م', en: 'EGP' },
    SAR: { ar: 'ر.س', en: 'SAR' },
    USD: { ar: 'د.أ', en: 'USD' },
    AED: { ar: 'د.إ', en: 'AED' },
  };
  const symbol = symbolMap[currency]?.[lang] || currency;
  return `${formatDisplayNumber(numeric, 1)} ${symbol}`;
}

/** General UI numbers: thousands separators, one decimal max, zero as dash. */
export function formatNumber(value: number | null | undefined, decimals = 1): string {
  return formatDisplayNumber(value, decimals);
}

/** Inventory/recipe quantities can require more precision than general UI values. */
export function formatQuantity(value: number | null | undefined, decimals = 3): string {
  return formatDisplayNumber(value, decimals);
}

export function formatPercent(value: number | null | undefined, decimals = 1): string {
  const formatted = formatDisplayNumber(value, decimals);
  return formatted === '-' ? '-' : `${formatted}%`;
}

export function formatDate(date: string | Date, lang: Language = 'ar'): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(date: string | Date, lang: Language = 'ar'): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function generateInvoiceNumber(prefix = 'INV'): string {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const rand = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return `${prefix}-${y}${m}${d}-${rand}`;
}

export function generateBarcode(): string {
  return String(Math.floor(Math.random() * 9000000000000) + 1000000000000);
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\x22]/g, '&quot;')
    .replace(/'/g, '&#39;');
}
