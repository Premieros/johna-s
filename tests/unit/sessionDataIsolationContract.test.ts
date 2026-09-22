import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('session and cached-data isolation', () => {
  it('never synthesizes application users or a local super admin in AuthContext', () => {
    const source = read('src/context/AuthContext.tsx');
    expect(source).not.toContain('createSuperAdminSession');
    expect(source).not.toContain('DEFAULT_ADMIN_CREDENTIALS');
    expect(source).not.toContain("role: 'super_admin'");
    expect(source).not.toContain(".from('users')\n        .insert");
    expect(source).not.toContain('makeFallbackUser');
    expect(source).toContain("code: 'profile_missing'");
    expect(source).toContain("data.is_active === false");
    expect(source).toContain('throw error');
    expect(source).toContain('PROFILE_RETRY_MAX_MS');
    expect(source).not.toContain('if (error || !data || data.is_active === false)');
  });

  it('requires an explicit branch before returning offline POS business data', () => {
    const source = read('src/context/OfflineContext.tsx');
    expect(source).toContain('if (!branchId)');
    expect(source).toContain("allProducts.filter((item) => belongsToBranch(item, branchId))");
    expect(source).toContain("allCategories.filter((item) => belongsToBranch(item, branchId))");
    expect(source).toContain("allCustomers.filter((item) => belongsToBranch(item, branchId))");
    expect(source).toContain("allTables.filter((item) => belongsToBranch(item, branchId))");
  });

  it('revalidates the active public profile without replacing the mounted app shell', () => {
    const source = read('src/core/security/SessionProfileGuard.tsx');
    expect(source).toContain(".from('users')");
    expect(source).toContain('!data || data.is_active === false');
    expect(source).toContain('await clearOfflineReadCache()');
    expect(source).toContain('await signOutRef.current()');
    expect(source).toContain('return <>{children}</>');
    expect(source).not.toContain('جاري التحقق من صلاحية الحساب');
  });
});
