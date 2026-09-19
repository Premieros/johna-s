import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260919235500_void_cross_operator_guard_context.sql',
  'utf8',
);

describe('cross-operator void ownership contract', () => {
  it('verifies the approved void context is set before mutating kitchen sends', () => {
    expect(migration).toContain("v_update_pos := position('UPDATE public.order_kitchen_sends' in v_def)");
    expect(migration).toContain("v_flag_pos := position('set_config(''app.approved_sent_item_void''' in v_def)");
    expect(migration).toContain('IF v_flag_pos = 0 OR v_flag_pos > v_update_pos THEN');
    expect(migration).toContain('approved sent-item void context is not set before kitchen-send update');
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
