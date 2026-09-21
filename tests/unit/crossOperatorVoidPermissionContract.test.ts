import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260921013500_cross_operator_sent_item_void_permission.sql',
  'utf8',
);
const defs = readFileSync('src/lib/permissionDefs.ts', 'utf8');
const contracts = readFileSync('src/lib/permissionContracts.ts', 'utf8');

describe('cross-operator sent-item Void permission contract', () => {
  it('keeps pos.void as the single visible permission for this action', () => {
    expect(defs).toContain("'pos.void'");
    expect(defs).toContain('إلغاء صنف مرسل للمطبخ (حتى طلب مستخدم آخر)');
    expect(contracts).toContain('لا تمنح تعديل أو نقل أو تغيير مالك');
  });

  it('creates an exact transaction-scoped Void authorization context', () => {
    expect(migration).toContain('public._sent_item_void_context_matches');
    expect(migration).toContain("app.sent_item_void_authorized");
    expect(migration).toContain("app.sent_item_void_order_id");
    expect(migration).toContain("app.sent_item_void_item_id");
    expect(migration).toContain("app.sent_item_void_actor_id");
    expect(migration).toContain("app.approved_sent_item_void");
  });

  it('allows the controlled context through ownership and permission guards only', () => {
    expect(migration).toContain('guard_pos_operator_ownership');
    expect(migration).toContain('guard_kitchen_send_operator_ownership');
    expect(migration).toContain('enforce_pos_permission_mutation');
    expect(migration).toContain('_sent_item_void_context_matches(OLD.order_id, OLD.id)');
    expect(migration).toContain('_sent_item_void_context_matches(OLD.id, NULL)');
  });

  it('does not modify printing or printer routing', () => {
    expect(migration).not.toContain('cloud_print_jobs');
    expect(migration).not.toContain('printer_settings');
    expect(migration).not.toContain('localPrintAgent');
    expect(migration).not.toContain('enqueue_cloud');
  });
});
