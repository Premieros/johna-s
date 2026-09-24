import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260924223500_raw_fifo_warehouse_transfer_cost_propagation.sql',
  'utf8',
).replace(/\r\n/g, '\n');

const applyGuardMigration = readFileSync(
  'supabase/migrations/20260924235200_raw_fifo_apply_warehouse_transfer_support.sql',
  'utf8',
).replace(/\r\n/g, '\n');

describe('raw FIFO warehouse-transfer cost propagation contract', () => {
  it('supports warehouse_transfer in historical FIFO changed references', () => {
    expect(migration).toContain("'purchase_return','warehouse_transfer'");
    expect(migration).toContain("p_reference_type='warehouse_transfer'");
    expect(migration).toContain('public._fifo_adjust_warehouse_transfer_delta');
  });

  it('allows warehouse_transfer in the apply-stage supported reference guard too', () => {
    expect(applyGuardMigration).toContain("'purchase_return','warehouse_transfer'");
    expect(applyGuardMigration).toContain('CREATE OR REPLACE FUNCTION public.raw_fifo_apply_backfill');
  });

  it('updates valuation only on the destination transfer receipt and batch', () => {
    expect(migration).toContain("il.reference_type='warehouse_transfer'");
    expect(migration).toContain('SET unit_cost=v_new_unit,total_cost=v_new_total');
    expect(migration).not.toMatch(/SET\s+quantity\s*=/i);
  });

  it('fails closed if transferred stock already has downstream consumption', () => {
    expect(migration).toContain('FIFO_WAREHOUSE_TRANSFER_DOWNSTREAM_CONSUMPTION_REQUIRES_CASCADE');
    expect(migration).toContain('AND il.quantity<0');
  });

  it('keeps the helper internal and printing out of scope', () => {
    expect(migration).toContain('FROM PUBLIC,anon,authenticated');
    expect(migration).toContain('TO service_role,postgres');
    expect(migration).not.toContain('print_jobs');
    expect(migration).not.toContain('printer');
  });
});
