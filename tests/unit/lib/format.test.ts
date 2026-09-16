import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatDisplayNumber,
  formatNumber,
  formatPercent,
  formatQuantity,
  generateBarcode,
  generateInvoiceNumber,
  todayISO,
} from '@/lib/format';

describe('unified display number contract', () => {
  it('uses thousands separators and at most one decimal for general display', () => {
    expect(formatDisplayNumber(1234567.5)).toBe('1,234,567.5');
    expect(formatDisplayNumber(1234567)).toBe('1,234,567');
    expect(formatNumber(1234.56)).toBe('1,234.6');
  });

  it('shows zero and non-finite values as a dash', () => {
    expect(formatDisplayNumber(0)).toBe('-');
    expect(formatNumber(undefined)).toBe('-');
    expect(formatDisplayNumber(Number.NaN)).toBe('-');
  });

  it('keeps higher precision only for quantities that need it', () => {
    expect(formatQuantity(0.12345)).toBe('0.123');
    expect(formatQuantity(1250)).toBe('1,250');
  });

  it('formats percentages with one decimal max and zero as dash', () => {
    expect(formatPercent(15.55)).toBe('15.6%');
    expect(formatPercent(15)).toBe('15%');
    expect(formatPercent(0)).toBe('-');
  });
});

describe('formatCurrency', () => {
  it('formats EGP with Arabic symbol by default', () => {
    expect(formatCurrency(12.5)).toBe('12.5 ج.م');
    expect(formatCurrency(1234567.5)).toBe('1,234,567.5 ج.م');
  });

  it('formats whole SAR values without forced decimals', () => {
    expect(formatCurrency(100, 'SAR', 'en')).toBe('100 SAR');
  });

  it('falls back to the raw currency code when unknown', () => {
    expect(formatCurrency(1, 'KWD', 'ar')).toBe('1 KWD');
  });

  it('shows null/undefined/zero amounts as dash', () => {
    expect(formatCurrency(undefined)).toBe('-');
    expect(formatCurrency(null)).toBe('-');
    expect(formatCurrency(0)).toBe('-');
  });
});

describe('formatNumber', () => {
  it('formats with no forced decimals', () => {
    expect(formatNumber(1234.5)).toBe('1,234.5');
  });

  it('respects explicit decimal precision', () => {
    expect(formatNumber(0.12345, 3)).toBe('0.123');
  });
});

describe('formatDate / formatDateTime', () => {
  it('formats a date for English locale', () => {
    const out = formatDate('2026-01-15', 'en');
    expect(out).toContain('2026');
  });

  it('formats a datetime with time', () => {
    const out = formatDateTime(new Date('2026-01-15T10:30:00Z'), 'en');
    expect(out).toContain('2026');
  });
});

describe('generateInvoiceNumber', () => {
  it('uses the given prefix and date parts', () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    expect(generateInvoiceNumber('INV')).toMatch(new RegExp(`^INV-${y}${m}${d}-\\d{4}$`));
  });
});

describe('generateBarcode', () => {
  it('generates a 13-digit barcode string', () => {
    expect(generateBarcode()).toMatch(/^\d{13}$/);
  });
});

describe('todayISO', () => {
  it('returns a YYYY-MM-DD date', () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('escapeHtml', () => {
  it('escapes HTML special characters (XSS safety)', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
    );
  });

  it('escapes single quotes and ampersands', () => {
    expect(escapeHtml("Tom & Jerry's")).toBe('Tom &amp; Jerry&#39;s');
  });

  it('returns empty string for null/undefined', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});
