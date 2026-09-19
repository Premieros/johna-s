import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('permission contract workspace wiring', () => {
  it('exposes a dedicated permission-managed route outside the Super Admin-only console', () => {
    const routes = read('src/app/routes.tsx');
    const routeDefs = read('src/core/navigation/routes.ts');
    const menu = read('src/core/navigation/menu.config.ts');

    expect(routeDefs).toContain("permissions: '/permissions'");
    expect(routes).toContain('APP_ROUTES.permissions');
    expect(routes).toContain('permission="roles.permissions.manage"');
    expect(menu).toContain("id: 'permissions'");
    expect(menu).toContain("permission: 'roles.permissions.manage'");
  });

  it('builds role controls from operational contracts and server grant rules', () => {
    const roles = read('src/features/admin/pages/RolesTab.tsx');

    expect(roles).toContain("can('roles.permissions.manage')");
    expect(roles).toContain('const canEditCurrent = mayEditRole(currentRole)');
    expect(roles).toContain('permissionContract(permission)');
    expect(roles).toContain('expandPermissionDependencies');
    expect(roles).toContain('removePermissionWithDependents');
    expect(roles).toContain('missingPermissionDependencies');
    expect(roles).toContain('const canGrantPermission');
    expect(roles).toContain('isPlatformAdmin || can(permission)');
    expect(roles).toContain('لا تملك حق منحها');
  });

  it('supports safe view-only and payment-only POS presets without touching print-agent permissions', () => {
    const roles = read('src/features/admin/pages/RolesTab.tsx');
    const contracts = read('src/lib/permissionContracts.ts');

    expect(roles).toContain('POS_PERMISSION_PRESETS');
    expect(roles).toContain('POS_INTERACTIVE_PRESET_SCOPE');
    expect(contracts).toContain("permissions: ['pos.view']");
    expect(contracts).toContain("permissions: ['pos.view', 'pos.payment.take']");
  });

  it('gates refund UI by canonical refund capabilities instead of cashier role names', () => {
    const sales = read('src/features/trade/pages/SalesPage.tsx');

    expect(sales).toContain("can('sales.refund.create')");
    expect(sales).toContain("can('refunds.approve')");
    expect(sales).not.toContain("const canRequestRefundApproval = user?.role === 'cashier';");
  });

  it('filters persisted role payloads through the canonical permission catalog', () => {
    const context = read('src/context/RolesContext.tsx');
    expect(context).toContain('new Set<string>(ALL_PERMISSIONS)');
    expect(context).toContain('known.has(p)');
  });
});
