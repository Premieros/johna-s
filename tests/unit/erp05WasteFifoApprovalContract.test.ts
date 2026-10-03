import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20261003123000_erp05_waste_fifo_approval.sql',
  'utf8',
);

describe('ERP-05 waste FIFO approval migration contract', () => {
  it('keeps legacy production waste read-only while preserving historical compatibility', () => {
    expect(migration).toContain("IF p_waste_type = 'production' THEN");
    expect(migration).toContain("RAISE EXCEPTION 'LEGACY_PRODUCTION_WASTE_READ_ONLY'");
    expect(migration).toContain("WHERE name = 'هالك إنتاج'");
    expect(migration).toContain("SET is_active = false");
  });

  it('derives approved product waste cost from FIFO batch layers', () => {
    expect(migration).toContain('SELECT id, quantity, unit_cost');
    expect(migration).toContain('v_actual_cost := v_actual_cost + (v_take * v_batch.unit_cost)');
    expect(migration).toContain("'FIFO_BATCH_COVERAGE_MISMATCH:product:%:remaining:%'");
    expect(migration).toContain('-round(v_actual_cost, 2)');
  });

  it('writes inventory-unit waste per consumed FIFO layer', () => {
    expect(migration).toContain('INSERT INTO public.inventory_unit_entries');
    expect(migration).toContain('-v_take');
    expect(migration).toContain('v_batch.unit_cost');
    expect(migration).toContain("'FIFO_BATCH_COVERAGE_MISMATCH:inventory_unit:%:remaining:%'");
  });

  it('defaults employee attribution to the authenticated actor', () => {
    expect(migration).toContain('COALESCE(p_employee_id, auth.uid())');
  });

  it('keeps SECURITY DEFINER waste RPC execution closed to anon and PUBLIC', () => {
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.create_waste_entry');
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.approve_waste');
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.get_waste_report');
    expect(migration).toContain('FROM PUBLIC, anon');
    expect(migration).toContain('TO authenticated, service_role');
  });

  it('persists exact approved cost separately from the rounded display estimate', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS approved_total_cost numeric(14,2)');
    expect(migration).toContain('approved_total_cost = round(v_actual_cost, 2)');
  });

  it('reports authoritative movement cost with historical fallback', () => {
    expect(migration).toContain("il.entry_type = 'waste'");
    expect(migration).toContain("iue.entry_type = 'waste'");
    expect(migration).toContain('s.fallback_total_cost');
  });

  it('repairs operational categories idempotently and seeds kitchen waste', () => {
    expect(migration).toContain("('هالك مطبخ', 'Kitchen Waste', true)");
    expect(migration).toContain("('هالك خامات', 'Raw Material Waste', true)");
    expect(migration).toContain('ON CONFLICT (name) DO UPDATE');
  });
});
