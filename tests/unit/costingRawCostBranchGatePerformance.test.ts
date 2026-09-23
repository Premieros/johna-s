import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const migration = fs.readFileSync(
  'supabase/migrations/20260923150000_raw_cost_overview_branch_gate.sql',
  'utf8',
);

describe('raw-material costing branch gate performance contract', () => {
  it('keeps permission-first and branch-mismatch guards unchanged', () => {
    expect(migration).toContain("IF auth.uid() IS NULL THEN");
    expect(migration).toContain("public.can_permission('reports.costing')");
    expect(migration).toContain('AND NOT public.user_may_access_branch(p_branch_id)');
    expect(migration).toContain("RAISE EXCEPTION 'BRANCH_MISMATCH'");
  });

  it('evaluates branch access once per branch instead of once per material row', () => {
    expect(migration).toContain('accessible_branches AS MATERIALIZED');
    expect(migration).toContain('FROM public.branches b');
    expect(migration).toContain('OR public.user_may_access_branch(b.id)');
    expect(migration).toContain('JOIN accessible_branches ab');
    expect(migration).not.toContain('public.user_may_access_branch(rm.branch_id)');
  });

  it('preserves function security posture and grants', () => {
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('SET search_path = public, pg_temp');
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.get_raw_material_cost_overview(uuid)',
    );
    expect(migration).toContain('FROM PUBLIC, anon');
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.get_raw_material_cost_overview(uuid)',
    );
    expect(migration).toContain('TO authenticated, service_role');
  });

  it('keeps the existing costing sources and precedence intact', () => {
    expect(migration).toContain('public._raw_cost_events_for_costing(NULL, p_branch_id)');
    expect(migration).toContain('inventory_latest AS MATERIALIZED');
    expect(migration).toContain('batch_average AS MATERIALIZED');
    expect(migration).toContain('r1.unit_cost');
    expect(migration).toContain('inv.unit_cost');
    expect(migration).toContain('ba.unit_cost');
    expect(migration).toContain('sm.default_cost');
  });
});
