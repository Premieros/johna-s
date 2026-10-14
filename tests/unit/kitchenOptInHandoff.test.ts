import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KitchenSendItem } from '@/features/pos/types';

const mocks = vi.hoisted(() => ({
  legacy: vi.fn(),
  rpc: vi.fn(),
  dispatch: vi.fn(),
  from: vi.fn(),
}));
vi.mock('@/api/rpc', () => ({ rpc: mocks.rpc }));
vi.mock('@/api', () => ({ supabase: { from: mocks.from } }));
vi.mock('@/features/pos/services/kitchen', () => ({ sendOrderToKitchen: mocks.legacy }));
vi.mock('@/features/pos/services/kitchenDispatch', () => ({ dispatchKitchenStations: mocks.dispatch }));
vi.mock('@/features/pos/services/localPrintAgent', () => ({
  groupKitchenItemsByStation: (items: KitchenSendItem[]) => {
    const groups: Record<string, KitchenSendItem[]> = {};
    for (const item of items) {
      const station = String(item.station_code || '').trim();
      if (station) (groups[station] ||= []).push(item);
    }
    return groups;
  },
}));

import { isKitchenHandoffOptedIn, sendOrderToKitchen } from '@/features/pos/services/kitchenHandoff';

const params = { p_order_id: 'test-order', p_sent_by: null, p_branch_id: 'test-branch', p_is_ar: true };
const items = [
  { station_code: 'بار', send_id: 's1', product_name: 'Tea', quantity: 1, current_quantity: 1 },
  { station_code: 'kit', send_id: 's2', product_name: 'Burger', quantity: 1, current_quantity: 1 },
] as KitchenSendItem[];
const result = (state: string, count?: number) => ({
  success: true, order_id: 'test-order', branch_id: 'test-branch',
  order_number: 'T-001', items_sent_count: 2, all_sent: true,
  sent: items, print_queue_state: state, print_queue_jobs: count,
});
const legacySuccess = { success: true, sent: items, items_sent_count: 2 };

function enableHandoffForSelectedBranch(): void {
  vi.stubEnv('VITE_KITCHEN_ATOMIC_PRINT_HANDOFF', 'true');
  vi.stubEnv('VITE_KITCHEN_ATOMIC_PRINT_BRANCH_IDS', 'test-branch');
}

describe('disabled-by-default kitchen handoff integration', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_KITCHEN_ATOMIC_PRINT_HANDOFF', '');
    vi.stubEnv('VITE_KITCHEN_ATOMIC_PRINT_BRANCH_IDS', '');
    mocks.legacy.mockResolvedValue(legacySuccess);
    mocks.dispatch.mockResolvedValue({ status: 'complete', stations: [], failed_stations: [], missing_station_items: 0 });
    mocks.rpc.mockResolvedValue({ data: result('queued', 2), error: null });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

  it('keeps the existing kitchen send as the ONLY default route', async () => {
    expect(isKitchenHandoffOptedIn(params.p_branch_id)).toBe(false);
    await sendOrderToKitchen(params);
    expect(mocks.legacy).toHaveBeenCalledOnce();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('keeps legacy sending if a globally enabled build has no explicit branch allowlist', async () => {
    vi.stubEnv('VITE_KITCHEN_ATOMIC_PRINT_HANDOFF', 'true');
    expect(isKitchenHandoffOptedIn(params.p_branch_id)).toBe(false);
    const r = await sendOrderToKitchen(params);
    expect(r).toEqual(legacySuccess);
    expect(mocks.legacy).toHaveBeenCalledOnce();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('does not switch another branch during a one-branch pilot', async () => {
    enableHandoffForSelectedBranch();
    expect(isKitchenHandoffOptedIn('different-branch')).toBe(false);
    const r = await sendOrderToKitchen({ ...params, p_branch_id: 'different-branch' });
    expect(r).toEqual(legacySuccess);
    expect(mocks.legacy).toHaveBeenCalledOnce();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('accepts case-insensitive exact branch IDs, never partial names', () => {
    enableHandoffForSelectedBranch();
    vi.stubEnv('VITE_KITCHEN_ATOMIC_PRINT_BRANCH_IDS', 'OTHER-BRANCH, TEST-BRANCH ');
    expect(isKitchenHandoffOptedIn('test-branch')).toBe(true);
    expect(isKitchenHandoffOptedIn('branch')).toBe(false);
    expect(isKitchenHandoffOptedIn('')).toBe(false);
  });

  it('accepts fully confirmed server tickets without a second enqueue or local paper', async () => {
    enableHandoffForSelectedBranch();
    const r = await sendOrderToKitchen(params);
    expect(mocks.rpc).toHaveBeenCalledWith('send_to_kitchen_with_print', {
      p_order_id: params.p_order_id, p_sent_by: null, p_is_ar: true,
    });
    expect(r.dispatch?.status).toBe('complete');
    expect(r.dispatch?.stations.map((s) => s.state)).toEqual(['queued', 'queued']);
    expect(mocks.legacy).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(r.suppress_kitchen_browser_popup).toBe(true);
  });

  it('routes server failure to the existing station fallback with saved order branch', async () => {
    enableHandoffForSelectedBranch();
    mocks.rpc.mockResolvedValue({ data: result('client_fallback'), error: null });
    const r = await sendOrderToKitchen(params);
    expect(r.success).toBe(true);
    expect(r.suppress_kitchen_browser_popup).toBe(false);
    expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      branchId: 'test-branch', allowLocalFallback: true, items,
      context: expect.objectContaining({ isAr: true }),
    }));
  });

  it('preserves English browser printing and never requests server Arabic ticket', async () => {
    enableHandoffForSelectedBranch();
    mocks.rpc.mockResolvedValue({ data: result('client_only'), error: null });
    const r = await sendOrderToKitchen({ ...params, p_is_ar: false });
    expect(r.suppress_kitchen_browser_popup).toBe(false);
    expect(mocks.rpc).toHaveBeenCalledWith('send_to_kitchen_with_print', expect.objectContaining({ p_is_ar: false }));
    expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({ isAr: false }),
    }));
  });

  it('does not attempt a second print when server acknowledgement is inconsistent', async () => {
    enableHandoffForSelectedBranch();
    mocks.rpc.mockResolvedValue({ data: result('queued', 1), error: null });
    const r = await sendOrderToKitchen(params);
    expect(r.success).toBe(true);
    expect(r.dispatch?.status).toBe('failed');
    expect(r.suppress_kitchen_browser_popup).toBe(true);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('suppresses any unknown print outcome instead of risking duplicate paper', async () => {
    enableHandoffForSelectedBranch();
    mocks.rpc.mockResolvedValue({ data: result('unexpected'), error: null });
    const r = await sendOrderToKitchen(params);
    expect(r.success).toBe(true);
    expect(r.dispatch?.status).toBe('failed');
    expect(r.suppress_kitchen_browser_popup).toBe(true);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('falls back to canonical send ONLY on known missing-RPC errors', async () => {
    enableHandoffForSelectedBranch();
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Missing function' } });
    const r = await sendOrderToKitchen(params);
    expect(r).toEqual(legacySuccess);
    expect(mocks.legacy).toHaveBeenCalledOnce();
  });

  it('never retries an ambiguous timeout that might have committed the kitchen send', async () => {
    enableHandoffForSelectedBranch();
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '57014', message: 'Timed out' } });
    const r = await sendOrderToKitchen(params);
    expect(r.success).toBe(false);
    expect(mocks.legacy).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});
