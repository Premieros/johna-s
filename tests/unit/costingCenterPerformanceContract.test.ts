import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260919233000_costing_center_bulk_performance.sql',
  'utf8',
);

describe('costing center bulk performance contract', () => {
  it('keeps Costing Center authorization and branch scope intact', () => {
    expect(migration).toContain("public.can_permission('reports.costing')");
    expect(migration).toContain('public.user_may_access_branch(p_branch_id)');
    expect(migration).toContain('IF NOT public.is_pos_admin() THEN');
    expect(migration).toContain('v_scope := v_user_branch');
    expect(migration).toContain('v_scope := p_branch_id');
    expect(migration).toContain("SET search_path = public, pg_temp");
  });

  it('calculates raw price events once instead of per material', () => {
    expect(migration).toContain('events AS MATERIALIZED');
    expect(migration).toContain('ranked AS MATERIALIZED');
    expect(migration).toContain('inventory_latest AS MATERIALIZED');
    expect(migration).toContain('batch_average AS MATERIALIZED');
    expect(migration).not.toContain('CROSS JOIN LATERAL (\n    SELECT public._raw_cost_context_for_costing');
  });

  it('aggregates recipe and BOM costs in bulk instead of scalar product loops', () => {
    expect(migration).toContain('raw_costs AS MATERIALIZED');
    expect(migration).toContain('product_wavg AS MATERIALIZED');
    expect(migration).toContain('bom_costs AS MATERIALIZED');
    expect(migration).toContain('recipe_costs AS MATERIALIZED');
    expect(migration).not.toContain('public._product_recipe_cost(');
    expect(migration).not.toContain('public._product_bom_cost(');
    expect(migration).not.toContain('public._product_wavg_cost(');
  });

  it('preserves zero-batch fallback to catalog default cost', () => {
    expect(migration).toMatch(/NULLIF\(\s*SUM\(b\.quantity \* COALESCE\(b\.unit_cost, 0\)\)[\s\S]*?,\s*0\s*\)/);
    expect(migration).toContain('srm.default_cost');
  });

  it('indexes settled kitchen-cost lookup used by sales summary', () => {
    expect(migration).toContain('idx_kitchen_inventory_events_settled_sale');
    expect(migration).toContain('ON public.order_kitchen_inventory_events(settled_sale_id)');
    expect(migration).toContain('WHERE settled_sale_id IS NOT NULL');
  });
});
