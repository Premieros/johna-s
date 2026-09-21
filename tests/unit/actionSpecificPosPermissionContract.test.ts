import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260921110000_action_specific_pos_permissions.sql',
  'utf8',
);

describe('action-specific POS permission contract', () => {
  it('uses exact transaction-scoped action proof instead of broadening manage-other access', () => {
    expect(migration).toContain('public._pos_action_context_matches');
    expect(migration).toContain("app.pos_action_actor_id");
    expect(migration).toContain("app.pos_action_order_id");
    expect(migration).toContain("app.pos_action_permission");
    expect(migration).not.toContain(
      'CREATE OR REPLACE FUNCTION public.can_manage_other_pos_orders()',
    );
  });

  it('keeps payment, send, cancel, and receipt print as independent capabilities', () => {
    expect(migration).toContain("'pos.payment.take'");
    expect(migration).toContain("'pos.send_kitchen'");
    expect(migration).toContain("'pos.cancel_order'");
    expect(migration).toContain("'pos.receipt.print'");
    expect(migration).toContain(
      "_pos_action_context_matches(OLD.id,'pos.payment.take')",
    );
    expect(migration).toContain(
      "_pos_action_context_matches(OLD.id,'pos.send_kitchen')",
    );
    expect(migration).toContain(
      "_pos_action_context_matches(OLD.id,'pos.cancel_order')",
    );
  });

  it('preserves cashier print queue routing and does not touch printer-agent configuration', () => {
    expect(migration).toContain(
      "v_order.branch_id,v_uid,'receipt','cashier'",
    );
    expect(migration).not.toContain('printer_settings');
    expect(migration).not.toContain('localPrintAgent');
    expect(migration).not.toContain('saveLocalPrinterRoutes');
    expect(migration).not.toContain('kitchen_station_id');
  });

  it('keeps branch access checks in every cross-operator entry point', () => {
    expect(migration.match(/user_may_access_branch/g)?.length || 0).toBeGreaterThanOrEqual(5);
    expect(migration).toContain("'BRANCH_MISMATCH'");
  });

  it('keeps generic edit and ownership controls outside the action-specific proof', () => {
    expect(migration).toContain("public.can_manage_other_pos_orders()");
    expect(migration).toContain("'pos.hold'");
    expect(migration).toContain("'ORDER_OPERATOR_REQUIRED'");
  });
});
