import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20261122124500_guard_purchase_correction_return_journal.sql', 'utf8',
);
describe('purchase correction GL return safety', () => {
  it('checks purchase return journal count before and after the return', () => {
    expect(migration).toContain("v_prior_return_journal_count");
    expect(migration).toContain("reference_type = 'purchase_return'");
    expect(migration).toContain("reference_number = v_purchase.invoice_number");
    expect(migration).toContain("<= v_prior_return_journal_count");
  });
  it('rejects a positive invoice with a zero return and rejects unknown source drift', () => {
    expect(migration).toContain("v_purchase.total > 0");
    expect(migration).toContain("PURCHASE_RETURN_AMOUNT_MISSING");
    expect(migration).toContain("PURCHASE_RETURN_JOURNAL_MISSING");
    expect(migration).toContain("PURCHASE_CORRECTION_GUARD_SOURCE_DRIFT");
  });
});
