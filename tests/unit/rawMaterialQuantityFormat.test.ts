import { describe, expect, it } from 'vitest';
import { formatExactQuantity, formatRawMaterialQuantity } from '../../src/lib/format';

describe('raw material quantity display', () => {
  it('keeps meaningful recipe decimals instead of using the general rounded formatter', () => {
    expect(formatExactQuantity(0.125)).toBe('0.125');
    expect(formatExactQuantity(0.000125)).toBe('0.000125');
    expect(formatExactQuantity(12.345678901234)).toBe('12.345678901234');
  });

  it('shows kilograms as exact grams for recipe/component display without changing the source value', () => {
    const value = 0.125;

    expect(formatRawMaterialQuantity(value, { code: 'kg', name: 'كيلوجرام' }, { preferGrams: true, lang: 'ar' })).toBe('125 جم');
    expect(formatRawMaterialQuantity(value, { code: 'kg', name: 'Kilogram' }, { preferGrams: true, lang: 'en' })).toBe('125 g');
    expect(value).toBe(0.125);
  });

  it('keeps sub-gram precision when converting recipe quantities from kilograms', () => {
    expect(formatRawMaterialQuantity(0.000125, { code: 'kg' }, { preferGrams: true, lang: 'en' })).toBe('0.125 g');
  });

  it('shows the configured unit when no display conversion is requested', () => {
    expect(formatRawMaterialQuantity(1.25, { symbol: 'L', name: 'Liter' }, { lang: 'en' })).toBe('1.25 L');
    expect(formatRawMaterialQuantity(3, { code: 'pcs', name: 'قطعة' }, { lang: 'ar' })).toBe('3 قطعة');
  });
});
