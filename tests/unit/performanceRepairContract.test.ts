import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

describe('performance repair contracts', () => {
  it('keeps POS catalog sellability diagnostic-only and off inventory refresh events', () => {
    const workspace = read('src/features/pos/pages/PosWorkspacePage.tsx');

    expect(workspace).toContain("supabase.rpc('get_pos_product_sellability'");
    expect(workspace).not.toContain("supabase.rpc('get_pos_product_availability'");
    expect(workspace).not.toContain('onInventoryChanged:');
    expect(workspace).not.toContain('receiptSaleId && effectiveBranch');
    expect(workspace).toContain('Quantity is not a client-side saleability gate.');
  });

  it('uses one diagnostic availability probe per active product', () => {
    const migration = read('supabase/migrations/20260921150000_pos_sellability_performance.sql');

    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.get_pos_product_sellability');
    expect(migration).toContain('v_check := public.check_product_availability(');
    expect(migration).not.toContain('v_low');
    expect(migration).not.toContain('v_high');
    expect(migration).not.toContain('v_mid');
    expect(migration).toContain("'INSUFFICIENT_RAW_MATERIAL_STOCK'");
    expect(migration).toContain('is_sellable := true;');
    expect(migration).toContain('availability_error := v_error;');
    expect(migration).toContain('public.user_may_access_branch(p_branch_id)');
  });

  it('uses realtime activity without the redundant five-second dashboard poll', () => {
    const standby = read('src/features/dashboard/components/DashboardStandbyBar.tsx');

    expect(standby).toContain('void loadActivity();');
    expect(standby).toContain(".on(");
    expect(standby).toContain("table: 'audit_log'");
    expect(standby).not.toContain('POLL_MS');
    expect(standby).not.toContain('setInterval(() => void loadActivity()');
  });

  it('coalesces realtime POS snapshot bursts and keeps a trailing refresh', () => {
    const realtime = read('src/features/pos/hooks/usePosRealtime.ts');

    expect(realtime).toContain('const inFlightRef = useRef(false);');
    expect(realtime).toContain('const trailingRefreshRef = useRef(false);');
    expect(realtime).toContain('if (inFlightRef.current)');
    expect(realtime).toContain('trailingRefreshRef.current = true;');
    expect(realtime).toContain('while (targetBranch)');
  });
});
