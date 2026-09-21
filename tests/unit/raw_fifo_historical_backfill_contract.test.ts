import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260921183000_raw_fifo_historical_backfill.sql',
  'utf8',
).replace(/\r\n/g, '\n');

describe('historical raw FIFO backfill contract', () => {
  it('separates prepare from apply and never auto-runs the backfill', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.raw_fifo_prepare_backfill');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.raw_fifo_apply_backfill');
    expect(migration).not.toMatch(/SELECT\s+public\.raw_fifo_apply_backfill\s*\(/i);
  });

  it('stores an auditable immutable replay plan, allocations and batch targets', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.raw_fifo_backfill_runs');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.raw_fifo_backfill_plan');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.raw_fifo_backfill_allocations');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.raw_fifo_backfill_batch_plan');
    expect(migration).toContain("allocation_type IN ('fifo','debt_settlement')");
  });

  it('replays debt first then FIFO lots in deterministic order', () => {
    expect(migration).toContain('ORDER BY event_at,id');
    expect(migration).toContain('ORDER BY expiry_date NULLS LAST,event_at,receipt_ledger_id,id');
    expect(migration).toContain("'debt_settlement'");
    expect(migration).toContain("'fifo'");
  });

  it('blocks stale plans and concurrent raw writes before applying', () => {
    expect(migration).toContain("'FIFO_BACKFILL_STALE_PLAN'");
    expect(migration).toContain("'FIFO_BACKFILL_BATCHES_CHANGED'");
    expect(migration).toContain(
      "hashtextextended(v_row.raw_material_id::text||':'||v_row.branch_id::text,0)",
    );
  });

  it('preserves net quantity and only normalizes per-batch residual allocation', () => {
    expect(migration).toContain("'FIFO_BACKFILL_NET_QUANTITY_MISMATCH'");
    expect(migration).toContain('SET quantity=bp.target_quantity');
    expect(migration).toContain('Refresh branch aggregate cache from canonical batches');
  });

  it('refuses to guess unsupported historical movement semantics', () => {
    expect(migration).toContain("'sale','kitchen_send','production','purchase_return'");
    expect(migration).toContain("'FIFO_BACKFILL_UNSUPPORTED_REFERENCE'");
  });

  it('handles purchase-return valuation through inventory_rm and stock_variance', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public._fifo_adjust_stock_variance_delta');
    expect(migration).toContain("semantic_key='inventory_rm'");
    expect(migration).toContain("semantic_key='stock_variance'");
    expect(migration).toContain("ELSIF p_reference_type='purchase_return' THEN");
  });

  it('keeps all backfill controls internal-only', () => {
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.raw_fifo_prepare_backfill(uuid)\n  FROM PUBLIC,anon,authenticated;',
    );
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.raw_fifo_apply_backfill(uuid)\n  FROM PUBLIC,anon,authenticated;',
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.raw_fifo_apply_backfill(uuid)\n  TO service_role,postgres;',
    );
  });
});
