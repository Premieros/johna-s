import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({fetch:vi.fn(),pay:vi.fn(),show:vi.fn(),base:{activeOrderId:'a',activeTable:null,orderType:'takeaway',tableId:null,cart:[],paidAmount:0,paymentMethod:'cash',checkoutOpen:false,setCheckoutOpen:vi.fn(),setPaidAmount:vi.fn()}}));
vi.mock('@/api',()=>({supabase:{}}));
vi.mock('@/context/LanguageContext',()=>({useLanguage:()=>({lang:'en',t:(s:string)=>s})}));
vi.mock('@/components/Toast',()=>({useToast:()=>({show:mocks.show})}));
vi.mock('@/features/pos/hooks/usePosPermissions',()=>({usePosPermissions:()=>({canEditOrder:false})}));
vi.mock('@/features/pos/hooks/usePosOrderBase',()=>({usePosOrder:()=>mocks.base}));
vi.mock('@/features/pos/services/settlementPreview',()=>({fetchOrderSettlementPreview:mocks.fetch}));
vi.mock('@/features/pos/services/payment',()=>({nextInvoiceNumber:async()=>'INV',createSaleOperationKey:()=> 'operation-key',processSaleForOrder:mocks.pay}));
import { usePosOrder, type UsePosOrderInput } from '@/features/pos/hooks/usePosOrder';
const input={branchId:'branch-a',products:[],customers:[],activeShift:{id:'shift-a'}} as unknown as UsePosOrderInput;
const preview=(order:string,branch:string,warehouse:string)=>({preview:{success:true,order_id:order,branch_id:branch,warehouse_id:warehouse,items:[],subtotal:20,discount_amount:0,tax_amount:0,total:20,pending_quantity:1,unsent_quantity:0,has_payable_items:true},error:null});
beforeEach(()=>{vi.clearAllMocks();mocks.base.activeOrderId='a';mocks.pay.mockResolvedValue({result:{success:false,error:'TEST_STOP'},error:null});});
describe('payment confirmation warehouse source',()=>{
  it('re-reads warehouse on confirmation rather than reusing checkout preview',async()=>{
    mocks.fetch.mockResolvedValueOnce(preview('a','branch-a','old-warehouse')).mockResolvedValueOnce(preview('a','branch-a','pinned-warehouse'));
    const {result}=renderHook(()=>usePosOrder(input));
    act(()=>result.current.setCheckoutOpen(true));
    await waitFor(()=>expect(mocks.base.setCheckoutOpen).toHaveBeenCalledWith(true));
    await act(async()=>{await result.current.completeSale();});
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.pay.mock.calls[0][0]).toMatchObject({p_order_id:'a',p_branch_id:'branch-a',p_warehouse_id:'pinned-warehouse'});
  });
  it('never submits a foreign-order/branch preview to process_sale',async()=>{
    mocks.fetch.mockResolvedValue(preview('b','branch-b','foreign-warehouse'));
    const {result}=renderHook(()=>usePosOrder(input));
    await act(async()=>{expect(await result.current.completeSale()).toBe(false);});
    expect(mocks.pay).not.toHaveBeenCalled();
    expect(mocks.show).toHaveBeenCalledWith('SETTLEMENT_PREVIEW_SCOPE_MISMATCH','error');
  });
});
