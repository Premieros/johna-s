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

  it('uses a bounded low-frequency refresh instead of unavailable roles realtime', () => {
    expect(source).toContain('const ROLE_REFRESH_INTERVAL_MS = 5 * 60_000;');
    expect(source).toContain('window.setInterval(() => {');
    expect(source).toContain('}, ROLE_REFRESH_INTERVAL_MS);');
    expect(source).toContain('window.clearInterval(timer);');
    expect(source).not.toContain("table: 'roles'");
    expect(source).not.toContain('supabase.removeChannel(channel)');
  });
});
