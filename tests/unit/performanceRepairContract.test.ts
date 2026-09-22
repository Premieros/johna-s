import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

describe('performance repair contracts', () => {
  it('keeps POS startup free from catalog-wide inventory/recipe preflight scans', () => {
    const workspace = read('src/features/pos/pages/PosWorkspacePage.tsx');

    expect(workspace).not.toContain("supabase.rpc('get_pos_product_sellability'");
    expect(workspace).not.toContain("supabase.rpc('get_pos_product_availability'");
    expect(workspace).not.toContain("from('product_components')");
    expect(workspace).not.toContain('onInventoryChanged:');
    expect(workspace).not.toContain('receiptSaleId && effectiveBranch');
    expect(workspace).toContain('authoritative inventory deduction point');
  });

  it('keeps the legacy sellability RPC definition available for non-POS compatibility during staged retirement', () => {
    const migration = read('supabase/migrations/20260921153000_pos_sellability_configuration_validation.sql');

    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.pos_product_configuration_error');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.get_pos_product_sellability');
    expect(migration).toContain('public.user_may_access_branch(p_branch_id)');
  });

  it('uses realtime activity without the redundant five-second dashboard poll', () => {
    const standby = read('src/features/dashboard/components/DashboardStandbyBar.tsx');

    expect(standby).toContain('void loadActivity();');
    expect(standby).toContain(".on(");
    expect(standby).toContain("table: 'audit_log'");
    expect(standby).toContain("if (status === 'SUBSCRIBED') void loadActivity();");
    expect(standby).not.toContain('POLL_MS');
    expect(standby).not.toContain('setInterval(() => void loadActivity()');
  });

  it('coalesces realtime POS snapshot bursts and keeps a trailing refresh', () => {
    const realtime = read('src/features/pos/hooks/usePosRealtime.ts');

    expect(realtime).toContain('const inFlightRef = useRef(false);');
    expect(realtime).toContain('const trailingRefreshRef = useRef(false);');
    expect(realtime).toContain('const loadCyclePromiseRef = useRef<Promise<void> | null>(null);');
    expect(realtime).toContain('if (inFlightRef.current && loadCyclePromiseRef.current)');
    expect(realtime).toContain('return loadCyclePromiseRef.current;');
    expect(realtime).toContain('setData(EMPTY_POS_REALTIME);');
    expect(realtime).toContain('while (targetBranch)');
  });
});
