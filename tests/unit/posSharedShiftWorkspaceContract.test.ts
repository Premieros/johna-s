import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('POS shared shift workspace contract', () => {
  it('loads the shared branch shift without cashier-role gating', () => {
    const workspace = read('src/features/pos/pages/PosWorkspacePage.tsx');
    expect(workspace).toContain("api.pos.getActiveShift({ p_branch_id: effectiveBranch })");
    expect(workspace).toContain('if (!effectiveBranch)');
    expect(workspace).not.toContain('if (!isCashier || !effectiveBranch)');
    expect(workspace).not.toContain('shift_exempt');
  });

  it('guards direct and deep-linked checkout with the real active shift', () => {
    const workspace = read('src/features/pos/pages/PosWorkspacePage.tsx');
    expect(workspace).toContain('activeShiftId: activeShift?.id || null');
    expect(workspace).toContain('if (!perms.canPay || !shiftChecked || pos.cart.length === 0) return;');
    expect(workspace).toContain('!initState.pay || !shiftChecked || checkoutOpen');
    expect(workspace).toContain('payConsumed.current = false;');
    expect(workspace).toContain('payConsumed.current = true;\n    handlePay();');

    const orderHookBase = read('src/features/pos/hooks/usePosOrderBase.ts');
    expect(orderHookBase).toContain("if (!activeShift) { show(t('shiftRequired'), 'error'); return false; }");
    expect(orderHookBase).not.toContain('isCashier && !activeShift');

    const offlineWrapper = read('src/features/pos/hooks/usePosOrder.ts');
    expect(offlineWrapper).toContain('if (!input.activeShift?.id) {');
  });

  it('exposes shift actions by exact permissions instead of role names', () => {
    const topBar = read('src/features/pos/components/topbar/PosTopBar.tsx');
    expect(topBar).toContain('activeShift ? perms.canCloseShift : perms.canOpenShift');
    expect(topBar).not.toContain('isCashier');

    const shiftsPage = read('src/features/trade/pages/ShiftsPage.tsx');
    expect(shiftsPage).toContain("can('shifts.open')");
    expect(shiftsPage).toContain("if (!can('shifts.open')) return;");
    expect(shiftsPage).not.toContain("user?.role === 'cashier'");

    const prerequisites = read('src/core/guard/prerequisitesRegistry.ts');
    const openShiftStep = prerequisites.slice(prerequisites.indexOf('open_shift: {'), prerequisites.indexOf('need_permission: {'));
    expect(openShiftStep).toContain("requiredPermission: 'shifts.open'");
    expect(openShiftStep).not.toContain("requiredPermission: 'shifts.manage'");
  });
});
