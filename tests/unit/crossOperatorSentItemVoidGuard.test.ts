import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260920123000_fix_cross_operator_sent_item_void.sql',
  'utf8',
);

describe('cross-operator sent-item void guard', () => {
  it('requires real manage-other-order authority plus void authority', () => {
    expect(migration).toContain('public.can_manage_other_pos_orders()');
    expect(migration).toContain("public.can_permission('pos.void')");
    expect(migration).toContain("public.can_permission('approvals.review')");
  });

  it('accepts a quantity decrease only after inventory events are reconciled', () => {
    expect(migration).toContain('order_kitchen_inventory_events');
    expect(migration).toContain('e.sent_quantity-e.voided_quantity');
    expect(migration).toContain('COALESCE(NEW.sent_quantity,0) < COALESCE(OLD.sent_quantity,0)');
    expect(migration).toContain('COALESCE(NEW.sent_quantity,0) = COALESCE(v_pending_inventory_quantity,0)');
    expect(migration).toContain('NEW.sent_by IS NOT DISTINCT FROM v_uid');
  });

  it('keeps the full-line cascade narrowly limited to an already reconciled zero row', () => {
    expect(migration).toContain("TG_OP='DELETE'");
    expect(migration).toContain('COALESCE(OLD.sent_quantity,0)=0');
    expect(migration).toContain('COALESCE(v_pending_inventory_quantity,0)=0');
  });

  it('does not trust the approved_sent_item_void session flag', () => {
    expect(migration).not.toContain('app.approved_sent_item_void');
  });

  it('does not touch printing or KDS routing', () => {
    expect(migration).not.toContain('cloud_print_jobs');
    expect(migration).not.toContain('printer');
    expect(migration).not.toContain('get_kitchen_queue');
  });
});
