import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('manufacturing retirement contract', () => {
  it('keeps retired production application files absent', () => {
    for (const path of [
      'src/api/domains/manufacturing.ts',
      'src/features/manufacturing/pages/ProductionOrdersPage.tsx',
      'src/features/manufacturing/pages/UnitProductionPage.tsx',
      'src/features/manufacturing/pages/ManufacturingCenterPage.tsx',
    ]) {
      expect(existsSync(resolve(root, path)), path).toBe(false);
    }
  });

  it('does not expose legacy production actions from the application API', () => {
    const modules = read('src/api/modules.ts');
    const catalog = read('src/api/domains/catalog.ts');

    expect(modules).not.toContain("domains/manufacturing");
    expect(catalog).not.toContain('produceInventoryUnit');
    expect(catalog).not.toContain("produce_inventory_unit");
  });

  it('does not expose production-only permissions in the application model', () => {
    const permissions = read('src/lib/permissionDefs.ts');
    const contracts = read('src/lib/permissionContracts.ts');
    const guard = read('src/core/guard/useOperationalGuard.ts');

    expect(permissions).not.toContain("'production.view'");
    expect(permissions).not.toContain("'production.manage'");
    expect(permissions).not.toContain("'production.waste'");
    expect(contracts).not.toContain("'production.manage'");
    expect(contracts).not.toContain("'production.waste'");
    expect(guard).not.toContain('guardProduction');
  });

  it('keeps old production URLs as safe redirects to recipes', () => {
    const routes = read('src/app/routes.tsx');

    expect(routes).toContain('path={APP_ROUTES.manufacturingCenter} element={<Navigate to={APP_ROUTES.recipes} replace />}');
    expect(routes).toContain('path={APP_ROUTES.production} element={<Navigate to={APP_ROUTES.recipes} replace />}');
    expect(routes).toContain('path={APP_ROUTES.productionUnits} element={<Navigate to={APP_ROUTES.recipes} replace />}');
  });
});
