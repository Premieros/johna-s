import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/context/RolesContext.tsx', 'utf8');

describe('roles refresh stability contract', () => {
  it('keys role bootstrap to stable user identity instead of the mutable session object', () => {
    expect(source).toContain('const sessionUserId = session?.user?.id ?? null;');
    expect(source).toContain('}, [sessionUserId]);');
    expect(source).not.toContain('}, [session]);');
  });

  it('keeps explicit refresh after role mutations', () => {
    expect(source).toContain('await refresh();');
    expect(source).toContain('saveRole');
    expect(source).toContain('createRole');
    expect(source).toContain('deleteRole');
  });

  it('refreshes roles on actual roles-table changes rather than token churn', () => {
    expect(source).toContain(".on('postgres_changes', { event: '*', schema: 'public', table: 'roles' }");
    expect(source).toContain('void supabase.removeChannel(channel);');
  });
});
