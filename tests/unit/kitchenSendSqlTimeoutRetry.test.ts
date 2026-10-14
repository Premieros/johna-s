import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), dispatch: vi.fn() }));
vi.mock('@/api/rpc', () => ({ rpc: mocks.rpc }));
vi.mock('@/api', () => ({ supabase: {} }));
vi.mock('@/features/pos/services/kitchenDispatch', () => ({ dispatchKitchenStations: mocks.dispatch }));

import { sendOrderToKitchen } from '@/features/pos/services/kitchen';

describe('kitchen send confirmed timeout recovery', () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.dispatch.mockReset();
  });

  it('retries one PostgreSQL 57014-aborted transaction and returns its successful send', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } })
      .mockResolvedValueOnce({ data: { success: true, order_id: 'order-1', sent: [], all_sent: true }, error: null });

    const result = await sendOrderToKitchen({ p_order_id: 'order-1', p_branch_id: 'branch-1' });
    expect(result.success).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'send_to_kitchen', { p_order_id: 'order-1', p_sent_by: null });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'send_to_kitchen', { p_order_id: 'order-1', p_sent_by: null });
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('does not replay ambiguous network failures or other errors', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'NETWORK_ERROR', message: 'connection interrupted' } });
    const result = await sendOrderToKitchen({ p_order_id: 'order-2' });
    expect(result.success).toBe(false);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('stops after the single retry when the database remains timed out', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '57014', message: 'statement timeout' } });
    const result = await sendOrderToKitchen({ p_order_id: 'order-3' });
    expect(result.success).toBe(false);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});
