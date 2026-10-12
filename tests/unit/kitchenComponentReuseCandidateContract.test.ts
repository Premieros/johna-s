import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const sql=readFileSync('scripts/experiments/kitchen_component_reuse_dispatch_candidate_20261012.sql','utf8');
describe('unwired kitchen component reuse safety boundary',()=>{
  it('creates only revoked candidate entry points with invoker privileges',()=>{
    const names=[...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z0-9_]+)/g)].map(match=>match[1]);
    expect(names).toEqual(['_kitchen_component_plans_candidate','_deduct_kitchen_raw_components_planned_candidate','_send_to_kitchen_component_reuse_candidate']);
    expect(sql).not.toMatch(/SECURITY\s+DEFINER/i);
    expect(sql.match(/SECURITY INVOKER/g)).toHaveLength(3);
    expect(sql.match(/REVOKE ALL ON FUNCTION/g)).toHaveLength(3);
    expect(sql).not.toMatch(/\bGRANT\b|ALTER TABLE|DISABLE TRIGGER|DROP (TABLE|FUNCTION)/i);
  });
  it('retains the order serialization and uses canonical FIFO',()=>{
    expect(sql).toMatch(/FROM public\.orders[\s\S]*?FOR UPDATE/);
    expect(sql).toContain('public._raw_remove_fifo(');
    expect(sql).toContain('v_effective_sent_by');
    expect(sql).toContain("p_created_by,\n      true");
  });
  it('bypasses planning when no exact configuration is repeated',()=>{
    expect(sql).toContain('HAVING count(*)>1');
    expect(sql).toContain('IF v_component_plan IS NULL THEN');
    expect(sql).toContain('public._deduct_kitchen_raw_components(');
  });
  it('keeps snapshot inserts and branch/permission checks in dispatch',()=>{
    expect(sql).toContain('public.user_may_access_branch(v_branch_id)');
    expect(sql).toContain("public.can_permission('pos.send_kitchen')");
    expect(sql).toContain('INSERT INTO public.order_kitchen_inventory_events(');
    expect(sql).toContain('snapshot_version');
  });
});
