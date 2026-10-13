import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendOrderToKitchen } from '@/features/pos/services/kitchen';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), dispatch: vi.fn(), select: vi.fn(), maybeSingle: vi.fn() }));
vi.mock('@/api/rpc', () => ({ rpc: mocks.rpc }));
vi.mock('@/api', () => ({ supabase: { from: () => ({ select: mocks.select }) } }));
vi.mock('@/features/pos/services/kitchenDispatch', () => ({ dispatchKitchenStations: mocks.dispatch }));
const data = (branch?: string) => ({ success: true, branch_id: branch, order_id: 'cleopatra-order', order_number: 'O43', items_sent_count: 1, sent: [{ order_item_id: 'line', product_id: 'product', quantity: 1, product_name: 'Coffee', station_code: 'bar' }] });
describe('authoritative kitchen print branch', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.dispatch.mockResolvedValue({ status: 'complete', stations: [], failed_stations: [], missing_station_items: 0 }); mocks.select.mockReturnValue({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }); });
  it('queues a Cleopatra order to Cleopatra even when Smoha is selected', async () => {
    mocks.rpc.mockResolvedValue({ data: data('cleopatra'), error: null });
    const r = await sendOrderToKitchen({ p_order_id: 'cleopatra-order', p_branch_id: 'smoha' });
    expect(r.success).toBe(true);
    expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({ branchId: 'cleopatra', allowLocalFallback: false, context: expect.objectContaining({ orderId: 'cleopatra-order' }) }));
    expect(mocks.select).not.toHaveBeenCalled();
  });
  it('resolves the exact saved order for older RPC responses', async () => {
    mocks.rpc.mockResolvedValue({ data: data(), error: null });
    mocks.maybeSingle.mockResolvedValue({ data: { branch_id: 'cleopatra' }, error: null });
    await sendOrderToKitchen({ p_order_id: 'cleopatra-order', p_branch_id: 'smoha' });
    expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({ branchId: 'cleopatra', allowLocalFallback: false }));
  });
  it('does not guess a print branch when the saved-order lookup fails', async () => {
    mocks.rpc.mockResolvedValue({ data: data(), error: null });
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { message: 'unavailable' } });
    const r = await sendOrderToKitchen({ p_order_id: 'cleopatra-order', p_branch_id: 'smoha' });
    expect(r.success).toBe(true);
    expect(r.dispatch?.status).toBe('failed');
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it('retains local fallback only for the matching workspace branch', async () => {
    mocks.rpc.mockResolvedValue({ data: data('cleopatra'), error: null });
    await sendOrderToKitchen({ p_order_id: 'cleopatra-order', p_branch_id: 'cleopatra' });
    expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({ allowLocalFallback: true }));
  });
});
