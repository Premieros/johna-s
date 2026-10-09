import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync('supabase/migrations/20261009221500_kitchen_raw_batch_full_balance_lookup_index.sql', 'utf8');

describe('kitchen raw negative-balance lookup index contract', () => {
  it('covers the full balance without excluding nonpositive raw batches', () => {
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS idx_raw_batches_branch_warehouse_material_all_qty');
    expect(migration).toContain('ON public.raw_material_batches (branch_id, warehouse_id, raw_material_id)');
    expect(migration).toContain('INCLUDE (quantity)');
    expect(migration).not.toMatch(/\bWHERE\s+quantity\s*>\s*0/i);
  });
  it('does not modify inventory, kitchen, accounting or printer functions', () => {
    expect(migration).not.toMatch(/\b(UPDATE|DELETE|TRUNCATE|CREATE\s+OR\s+REPLACE\s+FUNCTION|CREATE\s+TRIGGER)\b/i);
  });
});
