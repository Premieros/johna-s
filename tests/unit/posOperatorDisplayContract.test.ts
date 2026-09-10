import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { orderOperatorName } from '../../src/features/pos/utils/operatorName';

const root = resolve(process.cwd());
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('POS operator display contract', () => {
  it('uses the narrow display name with an email fallback and never exposes an id', () => {
    expect(orderOperatorName({ cashier: { id: 'user-1', full_name: '  Nora Ali  ', email: 'nora@example.test' } })).toBe('Nora Ali');
    expect(orderOperatorName({ cashier: { id: 'user-2', full_name: ' ', email: ' backup@example.test ' } })).toBe('backup@example.test');
    expect(orderOperatorName({ cashier: { id: 'private-id', full_name: null, email: null } })).toBeNull();
  });

  it('keeps operator labels branch-scoped without broadening users visibility', () => {
    const service = source('src/features/pos/services/posOrders.ts');
    const migration = source('supabase/migrations/20260907160000_pos_operator_ownership.sql');

    expect(service).toContain("supabase.rpc('get_pos_order_operator_labels', { p_branch_id: branchId })");
    expect(service).not.toContain("from('users')");
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.get_pos_order_operator_labels(p_branch_id uuid)');
    expect(migration).toContain("public.user_may_access_branch(p_branch_id)");
    expect(migration).toContain("public.can_permission('pos.view')");
    expect(migration).toContain("o.status IN ('open', 'held')");
  });

  it('shows the operator name on every active POS order and occupied-table surface', () => {
    const surfaces = [
      'src/features/pos/components/tables/TableCard.tsx',
      'src/features/pos/components/tables/TablesPanel.tsx',
      'src/features/pos/components/start/TablePickerStep.tsx',
      'src/features/pos/components/start/TableActionModal.tsx',
      'src/features/pos/components/floor/TableFloorPlan.tsx',
      'src/features/pos/components/orders/ActiveOrdersDrawer.tsx',
      'src/features/pos/components/orders/HeldOrdersModal.tsx',
      'src/features/pos/components/kitchen/KitchenPanel.tsx',
      'src/features/pos/pages/PosWorkspacePage.tsx',
    ];

    for (const path of surfaces) {
      expect(source(path), `${path} must render the scoped operator label`).toContain('orderOperatorName');
    }
  });

  it('prints the actual payment operator name on the receipt', () => {
    const orderHookBase = source('src/features/pos/hooks/usePosOrderBase.ts');
    const printing = source('src/features/pos/utils/printing.ts');

    expect(orderHookBase).toContain('operatorName: user?.full_name || user?.username || user?.email || null');
    expect(printing).toContain('receipt.operatorName');
    expect(printing).toContain("isAr ? 'المستخدم' : 'User'");
  });
});
