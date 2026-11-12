import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ normal: vi.fn(), split: vi.fn(), enqueue: vi.fn() }));
vi.mock('@/api', () => ({ pos: { processSaleIdempotent: mocks.normal, processSaleSplitIdempotent: mocks.split }, supabase: {} }));
vi.mock('@/core/offline/offlineStorage', () => ({ enqueueOfflineSale: mocks.enqueue }));
import { processSaleForOrder, processSplitSaleForOrder, type ProcessSalePayload, type ProcessSplitSalePayload } from '@/features/pos/services/payment';
const payload = { p_shift_id: 'shift', p_client_operation_key: 'same-operation', p_order_id: 'order' } as ProcessSalePayload;
beforeEach(() => { vi.clearAllMocks(); });
describe('payment diagnostic forwarding', () => {
  it('keeps a Supabase rejection and original payload without another financial attempt', async () => {
    const error = { code: 'PGRST116', message: 'API rejection' };
    mocks.normal.mockResolvedValue({ data: null, error });
    expect(await processSaleForOrder(payload)).toEqual({ result: null, error: 'API rejection', diagnostic: error });
    expect(mocks.normal).toHaveBeenCalledExactlyOnceWith(payload);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it('retains the original JavaScript failure and never queues an ambiguous online payment', async () => {
    const error = new TypeError('Failed to fetch');
    mocks.normal.mockRejectedValue(error);
    expect(await processSaleForOrder(payload)).toEqual({ result: null, error: error.message, diagnostic: error });
    expect(mocks.normal).toHaveBeenCalledTimes(1);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it('preserves split-payment errors without invoking a normal sale', async () => {
    const error = { code: '42501', message: 'Rejected' };
    const splitPayload = { ...payload, p_payments: [{ payment_method: 'cash', amount: 10 }] } as ProcessSplitSalePayload;
    mocks.split.mockResolvedValue({ data: null, error });
    expect(await processSplitSaleForOrder(splitPayload)).toEqual({ result: null, error: 'Rejected', diagnostic: error });
    expect(mocks.split).toHaveBeenCalledExactlyOnceWith(splitPayload);
    expect(mocks.normal).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});

it('keeps the explicit split tender after a long preparation delay',async()=>{
 vi.useFakeTimers();
 try {
  const payments=[{payment_method:'cash' as const,amount:5},{payment_method:'card' as const,amount:5}];
  mocks.split.mockResolvedValue({data:{success:true,sale_id:'sale'},error:null});
  vi.advanceTimersByTime(16000);
  await processSaleForOrder({...payload,p_payment_method:'cash',p_paid_amount:10},payments);
  expect(mocks.normal).not.toHaveBeenCalled();
  expect(mocks.split).toHaveBeenCalledWith(expect.objectContaining({p_payments:payments}));
 } finally {vi.useRealTimers();}
});
