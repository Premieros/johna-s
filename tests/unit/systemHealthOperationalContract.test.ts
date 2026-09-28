import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const page = readFileSync('src/features/admin/pages/SystemHealthPage.tsx', 'utf8');
const migration = readFileSync('supabase/migrations/20260928170000_system_health_snapshot.sql', 'utf8');

describe('system health operational contract', () => {
  it('uses one domain RPC instead of direct table-count fanout', () => {
    expect(page).toContain('admin.getSystemHealthSnapshot');
    expect(page).not.toContain("supabase.from(");
    expect(page).not.toContain("select('*', { count: 'exact', head: true })");
  });

  it('keeps the health RPC read-only and permission-first', () => {
    expect(migration).toContain("public.can_permission('settings.manage')");
    expect(migration).toContain('public.user_may_access_branch');
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('STABLE');
    expect(migration).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(migration).not.toMatch(/\bUPDATE\s+public\./i);
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it('observes frozen print/kitchen paths without mutating them', () => {
    expect(migration).toContain('FROM public.cloud_print_jobs');
    expect(migration).toContain('FROM public.order_kitchen_sends');
    expect(migration).toContain('FROM public.order_kitchen_inventory_events');
    expect(migration).not.toContain('claim_cloud_print_jobs');
    expect(migration).not.toContain('send_to_kitchen(');
  });

  it('surfaces local offline blocked and dead-letter states', () => {
    expect(page).toContain('getAllOfflineSales');
    expect(page).toContain("row.status === 'blocked'");
    expect(page).toContain("row.status === 'dead_letter'");
  });
});
