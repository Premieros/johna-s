import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260912181500_fix_pos_cart_negative_raw_sellthrough.sql'),
  'utf8',
);

describe('POS negative raw cart guard contract', () => {
  it('allows only raw-material shortage to pass through the cart guard', () => {
    expect(migration).toContain("IF COALESCE(v_result->>'error', '') <> 'INSUFFICIENT_RAW_MATERIAL_STOCK'");
    expect(migration).toContain("IF v_error <> 'INSUFFICIENT_RAW_MATERIAL_STOCK'");
    expect(migration).toContain("'mode', 'cart_raw_shortage_sellthrough'");
    expect(migration).toContain("'raw_shortage_only', true");
  });

  it('does not use another warehouse as fallback evidence', () => {
    expect(migration).not.toContain('v_other_warehouse_positive');
    expect(migration).not.toContain('warehouse_id IS DISTINCT FROM p_warehouse_id');
  });

  it('preserves the strict aggregate checker and security surface', () => {
    expect(migration).toContain('public.check_pos_cart_availability_strict_20260912');
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain("SET search_path TO 'public', 'pg_temp'");
    expect(migration).toContain('TO authenticated');
    expect(migration).toContain('TO service_role');
  });
});
