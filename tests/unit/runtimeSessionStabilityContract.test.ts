import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('runtime session stability contract', () => {
  it('does not convert transient profile read errors into sign-out', () => {
    const auth = read('src/context/AuthContext.tsx');
    const guard = read('src/core/security/SessionProfileGuard.tsx');

    expect(auth).toContain('if (error) {');
    expect(auth).toContain('throw error');
    expect(auth).toContain('PROFILE_RETRY_MAX_MS');
    expect(auth).not.toContain('if (error || !data || data.is_active === false)');
    expect(auth).toContain('isAuthSessionError(error)');
    expect(auth).toContain('supabase.auth.refreshSession()');
    expect(auth).toContain('setLoading(!(user?.id && user.id === activeSession.user.id))');

    expect(guard).toContain('PROFILE_REVALIDATION_RETRY_MS');
    expect(guard).toContain('if (error) {');
    expect(guard).toContain('isAuthSessionError(error)');
    expect(guard).toContain('supabase.auth.refreshSession()');
    expect(guard).not.toContain('if (error || !data || data.is_active === false)');
  });

  it('caps automatic stale-chunk recovery to one reload per browser tab', () => {
    const boundary = read('src/components/ErrorBoundary.tsx');

    expect(boundary).toContain("sessionStorage.getItem(STALE_CHUNK_KEY) !== null");
    expect(boundary).not.toContain('STALE_CHUNK_WINDOW_MS');
    expect(boundary).toContain('window.location.replace(url.toString())');
    expect(boundary).not.toContain('sessionStorage.removeItem(STALE_CHUNK_KEY)');
  });
});
