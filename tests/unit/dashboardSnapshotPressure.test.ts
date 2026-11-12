import { beforeEach, expect, it, vi } from 'vitest';
import { loadDashboardSalesSnapshot } from '@/features/dashboard/services/dashboardSnapshot';
const mocks = vi.hoisted(() => ({ snapshot: vi.fn() }));
vi.mock('@/api', () => ({ reporting: { getDashboardSalesSnapshot: mocks.snapshot } }));
const args = { branchId: 'a', currentFrom: '2026-11-01', currentTo: '2026-11-04', previousFrom: '2026-10-01', previousTo: '2026-10-04', granularity: 'day' as const };
beforeEach(() => mocks.snapshot.mockReset());
it.each(['57014', '42501', 'PGRST301', '53300'])('does not authorize expensive raw fallback after database failure %s', async code => {
  const error = { code, message: 'failed' };
  mocks.snapshot.mockResolvedValue({ data: null, error });
  await expect(loadDashboardSalesSnapshot(args)).rejects.toBe(error);
  expect(mocks.snapshot).toHaveBeenCalledTimes(1);
});
it.each(['PGRST202', '42883'])('preserves rolling-deployment compatibility when the snapshot RPC is absent %s', async code => {
  mocks.snapshot.mockResolvedValue({ data: null, error: { code } });
  expect(await loadDashboardSalesSnapshot(args)).toBeNull();
});
it('rejects malformed success instead of silently launching raw reads', async () => {
  mocks.snapshot.mockResolvedValue({ data: null, error: null });
  await expect(loadDashboardSalesSnapshot(args)).rejects.toThrow('DASHBOARD_SNAPSHOT_INVALID');
});
