import { describe, expect, it } from 'vitest';
import { formatFinancialCurrency } from '../../src/lib/format';

describe('formatFinancialCurrency', () => {
  it('always renders two decimals for reporting values', () => {
    expect(formatFinancialCurrency(153.33, 'EGP', 'ar')).toContain('153.33');
    expect(formatFinancialCurrency(153.3, 'EGP', 'en')).toContain('153.30');
    expect(formatFinancialCurrency(0, 'EGP', 'en')).toContain('0.00');
  });
});
