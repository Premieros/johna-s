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

  it('keeps roles zero-idle and refreshes only on meaningful recovery events', () => {
    expect(source).not.toContain('ROLE_REFRESH_INTERVAL_MS');
    expect(source).not.toContain('window.setInterval(');
    expect(source).not.toContain('window.clearInterval(');
    expect(source).toContain("window.addEventListener('focus', refreshIfStale)");
    expect(source).toContain("window.addEventListener('online', refreshIfStale)");
    expect(source).toContain("document.addEventListener('visibilitychange', refreshWhenVisible)");
    expect(source).toContain('if (now - lastRefreshAt < 60_000) return;');
    expect(source).not.toContain("table: 'roles'");
    expect(source).not.toContain('supabase.removeChannel(channel)');
  });
});
