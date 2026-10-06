import { describe, expect, it } from 'vitest';
import { expenseAccountLabel } from '@/features/reporting/utils/expenseAccountLabel';
describe('expense report account identity', () => {
  it('displays actual account code/name and supports PostgREST relation shapes', () => {
    expect(expenseAccountLabel({ expense_account: { code: '6100', name: 'كهرباء', name_en: 'Electricity' } }, 'ar')).toBe('6100 — كهرباء');
    expect(expenseAccountLabel({ expense_account: [{ code: '6100', name: 'كهرباء', name_en: 'Electricity' }] }, 'en')).toBe('6100 — Electricity');
  });
  it('does not invent an account from the category if RLS hides it', () => {
    expect(expenseAccountLabel({ category: 'Rent', account_id: 'hidden', expense_account: null }, 'en')).toBe('Unavailable');
  });
});
