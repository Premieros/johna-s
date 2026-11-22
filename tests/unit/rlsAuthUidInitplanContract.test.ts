import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20261122142000_cache_auth_uid_in_rls_policies.sql','utf8');
describe('auth.uid RLS initplan policy optimization', () => {
  it('retains branch scope and business permission checks', () => {
    expect(migration).toContain('user_may_access_branch');
    expect(migration).toContain('can_permission');
    expect(migration).toContain('get_branch_id()');
  });
  it('wraps every auth.uid invocation in a scalar SELECT', () => {
    const statements = migration.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n');
    expect(statements).not.toMatch(/(?<!select )auth\.uid\(\)/i);
    expect(migration).toContain('(select auth.uid())');
  });
  it('does not modify restrictive finance policies or registration bootstrap', () => {
    expect(migration).not.toContain('financial_visibility_');
    expect(migration).not.toContain('app.register_branch');
  });
});
