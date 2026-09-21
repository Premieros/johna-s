import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260921193000_raw_fifo_backfill_batch_identity_fix.sql',
  'utf8',
).replace(/\r\n/g, '\n');

describe('historical FIFO batch identity repair contract', () => {
  it('tracks unresolved debt by the actual canonical batch, not an OV prefix', () => {
    expect(migration).toContain('v_batch_id,\n          v_remaining,v_remaining,e.created_at');
    expect(migration).not.toContain("CASE WHEN e.batch_number LIKE 'OV-%' THEN v_batch_id ELSE NULL END");
  });

  it('rebuilds each batch as positive FIFO residual minus unresolved debt', () => {
    expect(migration).toContain('SELECT sum(l.available_qty)');
    expect(migration).toContain('SELECT sum(d.remaining_qty)');
    expect(migration).toContain('FROM rf_debts d WHERE d.oversold_batch_id=b.id');
  });

  it('keeps prepare internal-only', () => {
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.raw_fifo_prepare_backfill(uuid)');
    expect(migration).toContain('TO service_role,postgres;');
  });
});
