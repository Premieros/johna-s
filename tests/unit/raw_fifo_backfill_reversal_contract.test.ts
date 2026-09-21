import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260921190000_raw_fifo_backfill_reversal.sql',
  'utf8',
).replace(/\r\n/g, '\n');

describe('historical raw FIFO reversal contract', () => {
  it('adds an explicit reversed lifecycle state', () => {
    expect(migration).toContain("'reversing','reversed'");
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS reversed_at');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS reverse_error_text');
  });

  it('refuses reversal after any newer raw-material movement', () => {
    expect(migration).toContain("'FIFO_BACKFILL_REVERSE_STALE'");
    expect(migration).toContain('current_cutoff');
    expect(migration).toContain('backfill_cutoff');
  });

  it('reverses signed valuation deltas instead of replaying sales or purchases', () => {
    expect(migration).toContain(
      '-(v_row.target_cost-v_row.current_cost)',
    );
    expect(migration).toContain('SET total_cost=-v_row.current_cost');
    expect(migration).not.toContain('DELETE FROM public.sales');
    expect(migration).not.toContain('DELETE FROM public.purchases');
  });

  it('restores exact pre-backfill batch residuals', () => {
    expect(migration).toContain('SET quantity=bp.current_quantity');
    expect(migration).toContain('Refresh branch aggregate cache from restored canonical batches');
  });

  it('removes only reconciliation artifacts materialized by the run', () => {
    expect(migration).toContain('DELETE FROM public.raw_fifo_settlements s');
    expect(migration).toContain('WHERE s.run_id=p_run_id');
    expect(migration).toContain("je.reference_type='fifo_cogs_reconcile'");
    expect(migration).toContain("je.reference_type='fifo_stock_reconcile'");
  });

  it('is idempotent and internal-only', () => {
    expect(migration).toContain("'already_reversed',true");
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.raw_fifo_reverse_backfill(uuid)\n  FROM PUBLIC,anon,authenticated;',
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.raw_fifo_reverse_backfill(uuid)\n  TO service_role,postgres;',
    );
  });
});
