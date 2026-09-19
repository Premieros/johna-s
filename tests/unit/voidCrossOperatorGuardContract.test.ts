import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260919235500_void_cross_operator_guard_context.sql',
  'utf8',
);

describe('cross-operator void ownership contract', () => {
  it('sets the approved void context before mutating kitchen sends', () => {
    const flag = migration.indexOf("set_config('app.approved_sent_item_void'");
    const update = migration.indexOf('UPDATE public.order_kitchen_sends');
    expect(flag).toBeGreaterThanOrEqual(0);
    expect(update).toBeGreaterThan(flag);
  });

  it('keeps the kitchen-send ownership bypass tightly scoped', () => {
    expect(migration).toContain("v_internal_void");
    expect(migration).toContain("public.can_permission('pos.void')");
    expect(migration).toContain("public.can_permission('approvals.review')");
    expect(migration).toContain("NEW.order_id IS NOT DISTINCT FROM OLD.order_id");
    expect(migration).toContain("NEW.order_item_id IS NOT DISTINCT FROM OLD.order_item_id");
    expect(migration).toContain("COALESCE(NEW.sent_quantity, 0) <= COALESCE(OLD.sent_quantity, 0)");
    expect(migration).toContain("ARRAY['sent_quantity','sent_at','sent_by']");
  });

  it('does not touch printing or KDS routing', () => {
    expect(migration).not.toContain('cloud_print_jobs');
    expect(migration).not.toContain('print_routes');
    expect(migration).not.toContain('get_kitchen_queue');
  });
});
