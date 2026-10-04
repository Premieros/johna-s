import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20261004090000_dashboard_sales_rls_context_cache.sql',
  'utf8',
);

const rollback = readFileSync(
  'scripts/performance/rollback_dashboard_sales_rls_context_cache.sql',
  'utf8',
);

function policyBody(name: string): string {
  const start = migration.indexOf(`CREATE POLICY ${name}`);
  if (start < 0) return '';
  const next = migration.indexOf('CREATE POLICY ', start + 1);
  return migration.slice(start, next < 0 ? migration.length : next);
}

describe('Dashboard sales RLS context-cache contract', () => {
  it('keeps Permission-First sales and history checks', () => {
    const sales = policyBody('auth_select_sales');
    const visibility = policyBody('financial_visibility_sales');

    expect(sales).toContain("public.can_permission('sales.view')");
    expect(sales).toContain('public.user_may_access_branch(branch_id)');

    expect(visibility).toContain("public.can_permission('history.unlimited')");
    expect(visibility).toContain('private.get_financial_visibility_limits()');
    expect(visibility).toContain('public.history_business_date()');
    expect(visibility).toContain('public.history_date_start(');
    expect(visibility).toContain("md5(branch_id::text || ':' || id::text)");
    expect(visibility).toContain('public.user_may_access_branch(branch_id)');
  });

  it('moves statement-constant authorization checks into initPlan-shaped scalar SELECTs', () => {
    expect(migration).toContain("(SELECT public.is_platform_admin())");
    expect(migration).toContain("(SELECT public.can_permission('sales.view'))");
    expect(migration).toContain("(SELECT public.can_permission('history.unlimited'))");
    expect(migration).toContain("(SELECT public.is_pos_admin())");
    expect(migration).toContain("(SELECT public.get_branch_id())");
  });

  it('keeps child visibility restrictive while removing per-child by-id authorization helpers', () => {
    const items = policyBody('financial_visibility_sale_items');
    const payments = policyBody('sale_payments_financial_visibility_select');

    expect(items).toContain('AS RESTRICTIVE');
    expect(items).toContain('FROM public.sales s');
    expect(items).not.toContain('private.sale_read_visible_by_id');

    expect(payments).toContain('AS RESTRICTIVE');
    expect(payments).toContain('FROM public.sales s');
    expect(payments).not.toContain('private.sale_read_visible_by_id');
  });

  it('does not introduce SECURITY DEFINER or touch write/operational paths', () => {
    expect(migration).not.toContain('SECURITY DEFINER');
    expect(migration).not.toContain('FOR INSERT');
    expect(migration).not.toContain('FOR UPDATE');
    expect(migration).not.toContain('FOR DELETE');

    for (const forbidden of [
      'cloud_print_jobs',
      'send_to_kitchen',
      'kds',
      'inventory_ledger',
      'journal_entries',
      'settlement',
      'shift_operations',
    ]) {
      expect(migration.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('ships an explicit rollback to the prior policy contract', () => {
    expect(rollback).toContain('private.sale_read_visible(id, branch_id, created_at)');
    expect(rollback).toContain('private.sale_read_visible_by_id(sale_id)');
    expect(rollback).toContain("public.can_permission('sales.view')");
    expect(rollback).toContain('public.user_may_access_branch(branch_id)');
  });
});
