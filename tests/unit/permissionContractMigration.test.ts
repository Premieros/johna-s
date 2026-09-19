import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260920014500_permission_contract_ui_reconcile.sql',
  'utf8',
);

describe('permission contract migration', () => {
  it('migrates the obsolete pos.refund alias to the canonical refund initiator', () => {
    expect(migration).toContain("- 'pos.refund'");
    expect(migration).toContain("'sales.refund.create'");
    expect(migration).toContain("WHERE COALESCE(permissions, '[]'::jsonb) ? 'pos.refund'");
  });

  it('requires sales.refund.create to initiate a refund unless the caller can approve directly', () => {
    expect(migration).toContain("public.can_permission('sales.refund.create')");
    expect(migration).toContain("public.can_permission('refunds.approve')");
    expect(migration).toContain("'permission', 'sales.refund.create'");
    expect(migration).toContain('_process_refund_single_core');
  });

  it('keeps the change permission-first and away from printing', () => {
    expect(migration).not.toMatch(/role\s*=\s*'cashier'/i);
    expect(migration).not.toContain('cloud_print_jobs');
    expect(migration).not.toContain('print_agent');
    expect(migration).not.toContain('kitchen_stations');
  });
});
