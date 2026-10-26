import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Order, OrderItem, Product, DiningTable } from '@/lib/types';
import { usePosOrder, type UsePosOrderInput } from '@/features/pos/hooks/usePosOrderBase';
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), create: vi.fn(), update: vi.fn(), send: vi.fn(), show: vi.fn(), grants: new Set<string>() }));
vi.mock('@/api', () => ({ supabase: { from: vi.fn(()=>{const query={select:()=>query,eq:()=>query,maybeSingle:()=>Promise.resolve({data:{status:'occupied'},error:null})};return query;}) }, floorPlan: { createOrder: mocks.create, updateOrder: mocks.update } }));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ lang: 'en', t: (key: string) => key }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'cashier' } }) }));
vi.mock('@/lib/permissions', () => ({ useCan: () => (key: string) => mocks.grants.has(key) }));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ show: mocks.show }) }));
vi.mock('@/features/pos/services/posOrders', () => ({ fetchOrderForWorkspace: mocks.fetch }));
vi.mock('@/features/pos/services/kitchen', () => ({ sendOrderToKitchen: mocks.send }));
vi.mock('@/features/pos/services/cloudPrint', () => ({ getCloudOpenOrderPrintState: () => Promise.resolve({ known: true, locked: false }), enqueueCloudOpenOrderPrint: vi.fn() }));
vi.mock('@/features/pos/services/payment', () => ({ createSaleOperationKey: vi.fn(), processSaleForOrder: vi.fn(), nextInvoiceNumber: vi.fn(), fetchBranchWarehouseId: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
const product = { id: 'product', name: 'Coffee', sale_price: 10, is_active: true } as Product;
const snapshot = () => ({ order: { id: 'order', status: 'open', order_type: 'takeaway', table_id: null, order_number: 'O1' } as Order, items: [{ id: 'line', product_id: product.id, quantity: 1, unit_name: 'piece', unit_price: 10, discount_amount: 0, bonus_quantity: 0 }] as OrderItem[], products: [product] });
const input = (orderId: string | null): UsePosOrderInput => ({ branchId: 'branch', branchName: 'Branch', orderId, customers: [], effSettings: null, activeShift: null, products: [product], stockMap: {} });
describe('POS saved-order and cart recovery', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.grants.clear(); mocks.grants.add('pos.order.takeaway'); mocks.grants.add('pos.order.edit'); mocks.fetch.mockResolvedValue(snapshot()); mocks.create.mockResolvedValue({ data: { success: true, order_id: 'saved', order_number: 'O2' }, error: null }); mocks.update.mockResolvedValue({ data: { success: true }, error: null }); });
  it('keeps a deleted line deleted when feedback callbacks change on rerender', async () => {
    const { result, rerender } = renderHook(() => usePosOrder(input('order')));
    await waitFor(() => expect(result.current.cart).toHaveLength(1));
    act(() => result.current.removeFromCart('order-item:line'));
    rerender();
    await act(async () => { await Promise.resolve(); });
    expect(result.current.cart).toHaveLength(0);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it('does not restore deleted local edits from an older pending load', async () => {
    let resolve!: (value: ReturnType<typeof snapshot>) => void;
    mocks.fetch.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const { result } = renderHook(() => usePosOrder(input('order')));
    act(() => { result.current.addToCart(product); result.current.removeFromCart('product||'); });
    await act(async () => { resolve(snapshot()); });
    expect(result.current.cart).toHaveLength(0);
    expect(result.current.orderLoading).toBe(false);
  });
  it('retains the saved order after kitchen failure and updates it on retry', async () => {
    mocks.send.mockResolvedValue({ success: false, error: 'KITCHEN_SEND_FAILED', detail: 'send failed' });
    const { result } = renderHook(() => usePosOrder(input(null)));
    act(() => result.current.addToCart(product));
    await act(async () => { expect(await result.current.sendToKitchen()).toBe(false); });
    expect(result.current.activeOrderId).toBe('saved');
    act(() => result.current.addToCart(product));
    await act(async () => { await result.current.sendToKitchen(); });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ p_order_id: 'saved' }));
    expect(result.current.cart[0].quantity).toBe(2);
  });
  it('sends the saved order without rewriting it when the sender has no edit permission', async () => {
    mocks.grants.delete('pos.order.edit');
    mocks.send.mockResolvedValue({ success: true, items_sent_count: 0 });
    const { result } = renderHook(() => usePosOrder(input('order')));
    await waitFor(() => expect(result.current.cart).toHaveLength(1));
    await act(async () => { expect(await result.current.sendToKitchen()).toBe(true); });
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('stops before saving or sending when the current type capability is absent', async () => {
    mocks.grants.delete('pos.order.takeaway');
    const { result } = renderHook(() => usePosOrder(input('order')));
    await waitFor(() => expect(result.current.cart).toHaveLength(1));
    await act(async () => { expect(await result.current.sendToKitchen()).toBe(false); });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('hydrates a resumed table with its items before a separate table read can complete', async () => {
    const table={id:'table-27',branch_id:'branch',name:'27'} as DiningTable;
    mocks.fetch.mockResolvedValue({...snapshot(),order:{...snapshot().order,table_id:table.id,table,order_type:'dine_in'}});
    const {result}=renderHook(()=>usePosOrder(input('order')));
    await waitFor(()=>expect(result.current.orderLoading).toBe(false));
    expect(result.current.activeTable).toEqual(table);
    expect(result.current.activeOrderNumber).toBe('O1');
    expect(result.current.tableId).toBe('table-27');
  });
  it('clears previous table identity while another order is loading', async () => {
    const table={id:'table-28',branch_id:'branch',name:'28'} as DiningTable;
    mocks.fetch.mockResolvedValueOnce({...snapshot(),order:{...snapshot().order,table_id:table.id,table,order_type:'dine_in'}});
    const {result,rerender}=renderHook(({id})=>usePosOrder(input(id)),{initialProps:{id:'order'}});
    await waitFor(()=>expect(result.current.activeTable?.name).toBe('28'));
    let finish!: (value:ReturnType<typeof snapshot>)=>void;
    mocks.fetch.mockImplementationOnce(()=>new Promise(done=>{finish=done;}));
    rerender({id:'second-order'});
    expect(result.current.orderLoading).toBe(true);
    expect(result.current.activeTable).toBeNull();
    expect(result.current.activeOrderNumber).toBeNull();
    await act(async()=>{finish({...snapshot(),order:{...snapshot().order,id:'second-order'}});});
    expect(result.current.activeTable).toBeNull();
    expect(result.current.orderType).toBe('takeaway');
  });

});
