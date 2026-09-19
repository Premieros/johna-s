import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260919183000_fix_low_stock_product_branch_scope.sql',
  'utf8',
);

describe('low stock product branch scope contract', () => {
  it('filters products themselves by the effective branch', () => {
    expect(migration).toContain('AND (v_scope IS NULL OR p.branch_id = v_scope)');
  });

  it('keeps the existing inventory branch filter and threshold logic', () => {
    expect(migration).toContain('AND (v_scope IS NULL OR i.branch_id = v_scope)');
    expect(migration).toContain(
      "COALESCE(NULLIF(p.reorder_point, 0), p.low_stock_threshold::numeric(14,4), 0)",
    );
  });

  it('does not modify raw-material or inventory-unit alert sources', () => {
    expect(migration).not.toContain('raw_material_inventory');
    expect(migration).not.toContain('inventory_unit_batches');
    expect(migration).not.toMatch(/UPDATE\s+public\./i);
    expect(migration).not.toMatch(/INSERT\s+INTO\s+public\./i);
    expect(migration).not.toMatch(/DELETE\s+FROM\s+public\./i);
  });

  it('preserves hardened SECURITY DEFINER search_path', () => {
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain("SET search_path TO 'public', 'pg_temp'");
  });
});
