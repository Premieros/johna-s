import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260922123000_opening_inventory_fifo_cost_repair.sql',
  'utf8',
).replace(/\r\n/g, '\n');

describe('opening inventory FIFO cost repair contract', () => {
  it('separates prepare/apply/reverse and never auto-runs Production repair', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.raw_opening_cost_prepare_repair');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.raw_opening_cost_apply_repair');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.raw_opening_cost_reverse_repair');
    expect(migration).not.toMatch(/SELECT\s+public\.raw_opening_cost_apply_repair\s*\(/i);
  });

  it('uses only authoritative costing events and leaves missing candidates unresolved', () => {
    expect(migration).toContain('public._raw_cost_events_for_costing');
    expect(migration).toContain("'latest_at_or_before_opening'");
    expect(migration).toContain("'earliest_after_opening'");
    expect(migration).toContain("'NO_AUTHORITATIVE_PRICE_EVENT'");
    expect(migration).toContain('COALESCE(c.unit_cost,0)>0');
  });

  it('changes valuation only and delegates historical propagation to existing FIFO backfill', () => {
    expect(migration).toContain('SET unit_cost=v_row.candidate_cost');
    expect(migration).toContain('total_cost=round(quantity*v_row.candidate_cost,2)');
    expect(migration).toContain('public.raw_fifo_prepare_backfill(v_run.branch_id)');
    expect(migration).toContain('public.raw_fifo_apply_backfill(v_backfill_run)');
    expect(migration).not.toMatch(/SET\s+quantity\s*=\s*v_row\.opening_quantity/i);
  });

  it('keeps execution internal and printing out of scope', () => {
    expect(migration).toContain('FROM PUBLIC,anon,authenticated');
    expect(migration).toContain('TO service_role,postgres');
    expect(migration).not.toContain('print_jobs');
    expect(migration).not.toContain('cloud_print');
    expect(migration).not.toContain('printer');
  });

  it('requires FIFO reversal before restoring opening cost to zero', () => {
    const reversePos = migration.indexOf('public.raw_fifo_reverse_backfill(v_run.fifo_backfill_run_id)');
    const zeroPos = migration.indexOf('SET unit_cost=0');
    expect(reversePos).toBeGreaterThan(0);
    expect(zeroPos).toBeGreaterThan(reversePos);
    expect(migration).toContain('OPENING_COST_REPAIR_REVERSE_BATCH_CHANGED');
    expect(migration).toContain('OPENING_COST_REPAIR_REVERSE_LEDGER_CHANGED');
  });
});
