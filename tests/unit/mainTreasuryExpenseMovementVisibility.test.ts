import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(
  'supabase/migrations/20260930013000_purchase_return_link_main_treasury_movement.sql',
  'utf8',
);
const treasuryPage = fs.readFileSync(
  'src/features/accounting/pages/TreasuryPage.tsx',
  'utf8',
);

describe('purchase return linkage and main treasury expense movement visibility', () => {
  it('links legacy and future purchase return journals without changing financial values', () => {
    expect(migration).toContain('trg_link_purchase_return_reference');
    expect(migration).toContain("je.reference_type = 'purchase_return'");
    expect(migration).toContain('SET reference_id = c.purchase_id');
    expect(migration).not.toContain('UPDATE public.purchases');
    expect(migration).not.toContain('UPDATE public.purchase_items');
  });

  it('mirrors main treasury expense funding into the movement audit feed only', () => {
    expect(migration).toContain('trg_sync_main_treasury_expense_movement');
    expect(migration).toContain("v_entry.reference_type NOT IN ('expense_funding','expense_funding_reversal')");
    expect(migration).toContain("v_tx_type := 'withdrawal'");
    expect(migration).toContain("v_tx_type := 'deposit'");
    expect(migration).toContain('INSERT INTO public.treasury_transactions');
    expect(migration).not.toContain('INSERT INTO public.journal_entries');
    expect(migration).not.toContain('_post_journal_entry');
  });

  it('backfills missing main treasury expense movements idempotently', () => {
    expect(migration).toContain("WHERE je.reference_type IN ('expense_funding','expense_funding_reversal')");
    expect(migration).toContain('AND NOT EXISTS (');
    expect(migration).toContain("tx.reference_type=CASE WHEN f.reference_type='expense_funding' THEN 'expense' ELSE 'expense_reversal' END");
  });

  it('shows a human-readable movement description in treasury UI', () => {
    expect(treasuryPage).toContain("header: isAr ? 'البيان' : 'Details'");
    expect(treasuryPage).toContain("tx.notes || '-'");
  });
});
