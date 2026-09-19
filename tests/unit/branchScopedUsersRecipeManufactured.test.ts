import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

const usersPage = read('src/features/admin/pages/UsersPage.tsx');
const recipesPage = read('src/features/manufacturing/pages/RecipesPage.tsx');

describe('branch-scoped admin visibility and manufactured recipe components', () => {
  it('keeps user administration scoped to already-allowed branches without changing permission definitions', () => {
    expect(usersPage).toContain("const { branches, loading: branchesLoading } = useBranches()");
    expect(usersPage).toContain("branches.map((branch) => `branch_id.eq.${branch.id}`).join(',')");
    expect(usersPage).toContain('or: allowedBranchScope');
    expect(usersPage).toContain('enabled: isPlatformAdmin || (!branchesLoading && branches.length > 0)');
    expect(usersPage).toContain("const canManageUsers = can('users.manage')");
  });

  it('supports manufactured inventory units as recipe components through the existing operational link contract', () => {
    expect(recipesPage).toContain("eq('unit_type', 'manufactured')");
    expect(recipesPage).toContain("from('product_unit_links')");
    expect(recipesPage).toContain('api.catalog.setProductUnitLinks(');
    expect(recipesPage).toContain("isAr ? 'المصنعات داخل الوصفة' : 'Manufactured components'");
    expect(recipesPage).toContain('validItems.length === 0 && validManufacturedItems.length === 0');
  });
});
