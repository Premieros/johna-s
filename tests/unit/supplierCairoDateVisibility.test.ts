import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { businessDateISO } from '../../src/lib/businessTime';

const suppliersPage = fs.readFileSync('src/features/parties/pages/SuppliersPage.tsx', 'utf8');
const paymentsPage = fs.readFileSync('src/features/accounting/pages/PaymentsPage.tsx', 'utf8');

describe('supplier Cairo-date visibility', () => {
  it('uses Cairo date across the UTC midnight boundary', () => {
    const instant = new Date('2026-09-29T21:30:00.000Z');
    expect(businessDateISO(instant)).toBe('2026-09-30');
  });

  it('uses the Cairo business date for supplier AP aging', () => {
    expect(suppliersPage).toContain('p_as_of: businessDateISO()');
    expect(paymentsPage).toContain('const asOf = businessDateISO();');
  });

  it('does not use UTC calendar date for supplier aging/opening defaults', () => {
    expect(suppliersPage).not.toContain("new Date().toISOString().slice(0, 10)");
    expect(paymentsPage).not.toContain("const asOf = new Date().toISOString().slice(0, 10)");
  });
});
