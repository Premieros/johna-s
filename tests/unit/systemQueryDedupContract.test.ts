import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('system-wide duplicate query reduction contract', () => {
  it('routes Supabase reads through the shared PostgREST coordinator', () => {
    const client = read('src/lib/supabase.ts');
    const coordinator = read('src/lib/postgrestDedupingFetch.ts');

    expect(client).toContain('postgrestDedupingFetch');
    expect(client).toContain('global:');
    expect(client).toContain('fetch: postgrestDedupingFetch');
    expect(coordinator).toContain('const inFlight = new Map');
    expect(coordinator).toContain('generation += 1');
    expect(coordinator).not.toContain('recentReads');
    expect(coordinator).not.toContain('READ_REUSE_WINDOW_MS');
    expect(coordinator).toContain("request.headers.get('authorization')");
  });

  it('returns list rows and their exact total in one paginated request', () => {
    const hook = read('src/hooks/usePaginatedRows.ts');

    expect(hook).toContain("select(select, { count: 'exact' })");
    expect(hook).toContain('buildDataQuery(0, pageSize - 1, true)');
    expect(hook).not.toContain("select('id', { count: 'exact', head: true })");
  });

  it('reuses the shared branch/settings sources in POS instead of querying them again', () => {
    const workspace = read('src/features/pos/pages/PosWorkspacePage.tsx');

    expect(workspace).toContain('useBranches()');
    expect(workspace).toContain('settings: sharedSettings');
    expect(workspace).not.toContain("supabase.from('settings').select('*').maybeSingle()");
    expect(workspace).not.toContain("supabase.from('branches').select('*').eq('is_active', true).order('name')");
  });

  it('keeps removed dashboard cards and their dedicated reads absent', () => {
    const dashboard = read('src/features/dashboard/pages/DashboardDataPage.tsx');

    for (const marker of [
      'kpi-open-orders',
      'kpi-net-sales',
      'kpi-occupied-tables',
      'kpi-available-tables',
      'kpi-open-shifts',
      'kpi-active-users',
    ]) {
      expect(dashboard).not.toContain(marker);
    }

    expect(dashboard).not.toContain("supabase.from('dining_tables')");
    expect(dashboard).not.toContain("supabase.from('shifts')");
    expect(dashboard).not.toContain("supabase.from('users')");
  });
});
