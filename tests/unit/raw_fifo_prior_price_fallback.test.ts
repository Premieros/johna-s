import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260925013000_raw_fifo_prior_price_fallback.sql',
  'utf8',
).replace(/\r\n/g, '\n');

describe('raw FIFO prior-price fallback contract', () => {
  it('uses only authoritative prices at or before the consumption timestamp', () => {
    expect(migration).toContain('ce.priced_at<=il.created_at');
    expect(migration).toContain("'NO_PRIOR_AUTHORITATIVE_PRICE'");
    expect(migration).toContain("'FUTURE_PRICE_REFUSED'");
    expect(migration).not.toContain('earliest_after');
  });

  it('supports only reference types with explicit cost propagation', () => {
    expect(migration).toContain("IN ('sale','kitchen_send','production','purchase_return')");
    expect(migration).toContain("'REFERENCE_TYPE_UNSUPPORTED'");
    expect(migration).toContain('public._fifo_adjust_reference_delta');
  });

  it('keeps prepare/apply/reverse quantity-invariant', () => {
    const repairStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.raw_fifo_price_fallback_prepare');
    const settleStart = migration.indexOf('CREATE OR REPLACE FUNCTION public._raw_fifo_settle_receipt');
    const repairSection = migration.slice(repairStart, settleStart);
    expect(repairSection).not.toMatch(/UPDATE\s+public\.raw_material_batches[\s\S]*SET\s+quantity/i);
    expect(repairSection).not.toMatch(/UPDATE\s+public\.inventory_ledger[\s\S]*SET\s+quantity/i);
  });

  it('tracks provisional open-debt cost separately from final historical valuation', () => {
    expect(migration).toContain('raw_fifo_debt_price_estimates');
    expect(migration).toContain('original_estimated_quantity');
    expect(migration).toContain('remaining_estimated_quantity');
    expect(migration).toContain('replaced_quantity');
    expect(migration).toContain('zero_cost_finalized_quantity');
  });

  it('replaces provisional cost by actual-minus-estimate instead of double charging', () => {
    expect(migration).toContain('v_delta:=v_actual_value-v_estimate_value');
    expect(migration).toContain('v_total_adjustment:=v_total_adjustment+v_delta');
    expect(migration).toContain("'cost_adjustment',v_total_adjustment");
  });

  it('preserves prior-price fallback when a later receipt is itself zero-cost', () => {
    expect(migration).toContain("IF COALESCE(v_receipt.unit_cost,0)>0 THEN");
    expect(migration).toContain('v_delta:=0;');
    expect(migration).toContain('zero_cost_finalized_quantity=zero_cost_finalized_quantity+v_estimate_take');
  });

  it('refuses reversal after later receipts consume provisional estimates', () => {
    expect(migration).toContain("'FIFO_PRICE_FALLBACK_ESTIMATE_CONSUMED'");
    expect(migration).toContain('abs(e.remaining_estimated_quantity-e.original_estimated_quantity)>0.000001');
  });

  it('keeps the repair internal and leaves printing out of scope', () => {
    expect(migration).toContain('FROM PUBLIC,anon,authenticated');
    expect(migration).toContain('TO service_role,postgres');
    expect(migration).not.toContain('print_jobs');
    expect(migration).not.toContain('printer');
  });
});
