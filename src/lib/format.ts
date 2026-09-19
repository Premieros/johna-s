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

/** Financial/reporting display: always show two decimals without changing receipt/POS formatting. */
export function formatFinancialCurrency(
  amount: number | null | undefined,
  currency = 'EGP',
  lang: Language = 'ar',
): string {
  const numeric = numericOrZero(amount);
  const symbolMap: Record<string, { ar: string; en: string }> = {
    EGP: { ar: 'ج.م', en: 'EGP' },
    SAR: { ar: 'ر.س', en: 'SAR' },
    USD: { ar: 'د.أ', en: 'USD' },
    AED: { ar: 'د.إ', en: 'AED' },
  };
  const symbol = symbolMap[currency]?.[lang] || currency;
  const formatted = numeric.toLocaleString(DISPLAY_LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${formatted} ${symbol}`;
}

/** General UI numbers: thousands separators, one decimal max, zero as dash. */
export function formatNumber(value: number | null | undefined, decimals = 1): string {
  return formatDisplayNumber(value, decimals);
}

/** Inventory/recipe quantities can require more precision than general UI values. */
export function formatQuantity(value: number | null | undefined, decimals = 3): string {
  return formatDisplayNumber(value, decimals);
}

/**
 * Inventory and recipe quantities must never be silently approximated for display.
 * Numeric JSON values are rendered with all meaningful decimals received from the API,
 * while still applying locale thousands separators.
 */
export function formatExactQuantity(value: number | null | undefined): string {
  const numeric = numericOrZero(value);
  if (Math.abs(numeric) < ZERO_EPSILON) return '-';
  return numeric.toLocaleString(DISPLAY_LOCALE, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 12,
    useGrouping: true,
  });
}

export interface MeasurementUnitDisplay {
  code?: string | null;
  name?: string | null;
  symbol?: string | null;
}

function normalizedUnitTokens(unit?: MeasurementUnitDisplay | null): string[] {
  if (!unit) return [];
  return [unit.code, unit.name, unit.symbol]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim().toLocaleLowerCase());
}

function isKilogramUnit(unit?: MeasurementUnitDisplay | null): boolean {
  const tokens = normalizedUnitTokens(unit);
  return tokens.some((token) => ['kg', 'kgs', 'kilogram', 'kilograms', 'كجم', 'كغ', 'كيلو', 'كيلوجرام'].includes(token));
}

function isGramUnit(unit?: MeasurementUnitDisplay | null): boolean {
  const tokens = normalizedUnitTokens(unit);
  return tokens.some((token) => ['g', 'gr', 'gram', 'grams', 'جم', 'غ', 'جرام'].includes(token));
}

export function measurementUnitLabel(unit?: MeasurementUnitDisplay | null): string {
  return unit?.symbol?.trim() || unit?.name?.trim() || unit?.code?.trim() || '';
}

/**
 * Formats a raw-material quantity together with its configured measurement unit.
 * For recipe/component presentation only, kilograms can be rendered as exact grams
 * to avoid misleading rounded values such as 0.1 kg for an actual 125 g component.
 * This is a display conversion only; stored quantities and costing remain unchanged.
 */
export function formatRawMaterialQuantity(
  value: number | null | undefined,
  unit?: MeasurementUnitDisplay | null,
  options: { preferGrams?: boolean; lang?: Language } = {},
): string {
  const numeric = numericOrZero(value);
  if (Math.abs(numeric) < ZERO_EPSILON) return '-';

  if (options.preferGrams && isKilogramUnit(unit)) {
    const gramLabel = options.lang === 'en' ? 'g' : 'جم';
    return `${formatExactQuantity(numeric * 1000)} ${gramLabel}`;
  }

  const label = isGramUnit(unit)
    ? (options.lang === 'en' ? 'g' : 'جم')
    : measurementUnitLabel(unit);
  return `${formatExactQuantity(numeric)}${label ? ` ${label}` : ''}`;
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
