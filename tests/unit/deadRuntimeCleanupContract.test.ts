import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('dead runtime cleanup contract', () => {
  it('keeps the retired browser-side sales deduction helper removed', () => {
    expect(existsSync('src/lib/sales-deduction.ts')).toBe(false);
  });

  it('keeps tests for the retired helper removed with the dead runtime path', () => {
    expect(existsSync('tests/unit/sales_deduction_units_only.test.ts')).toBe(false);
    expect(existsSync('tests/unit/pos/productComponentDeduction.test.ts')).toBe(false);
  });
});
