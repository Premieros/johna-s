import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({permissions:{canEditOrder:false,canDiscount:false},discount:vi.fn(),fetch:vi.fn(),invoice:vi.fn(),pay:vi.fn(),show:vi.fn(),base:{activeOrderId:'a',activeTable:null,orderType:'takeaway',tableId:null,cart:[],discountType:'amount' as 'amount'|'percent',discountAmount:0,paidAmount:0,paymentMethod:'cash',checkoutOpen:false,resetWorkspace:vi.fn(),setCheckoutOpen:vi.fn(),setPaidAmount:vi.fn(),setDiscountType:vi.fn(),setDiscountAmount:vi.fn()}}));
vi.mock('@/api',()=>({supabase:{},floorPlan:{setCheckoutDiscount:mocks.discount}}));
vi.mock('@/context/LanguageContext',()=>({useLanguage:()=>({lang:'en',t:(s:string)=>s})}));
vi.mock('@/components/Toast',()=>({useToast:()=>({show:mocks.show})}));
vi.mock('@/features/pos/hooks/usePosPermissions',()=>({usePosPermissions:()=>mocks.permissions}));
vi.mock('@/features/pos/hooks/usePosOrderBase',()=>({usePosOrder:()=>mocks.base}));
vi.mock('@/features/pos/services/settlementPreview',()=>({fetchOrderSettlementPreview:mocks.fetch}));
vi.mock('@/features/pos/services/payment',()=>({nextInvoiceNumber:mocks.invoice,createSaleOperationKey:()=> 'operation-key',processSaleForOrder:mocks.pay}));
import { usePosOrder, type UsePosOrderInput } from '@/features/pos/hooks/usePosOrder';
const input={branchId:'branch-a',products:[],customers:[],activeShift:{id:'shift-a'}} as unknown as UsePosOrderInput;
const preview=(order:string,branch:string,warehouse:string)=>({preview:{success:true,order_id:order,branch_id:branch,warehouse_id:warehouse,items:[],subtotal:20,discount_amount:0,tax_amount:0,total:20,pending_quantity:1,unsent_quantity:0,has_payable_items:true},error:null});
beforeEach(()=>{vi.clearAllMocks();mocks.base.activeOrderId='a';mocks.base.discountAmount=0;mocks.base.discountType='amount';mocks.permissions.canDiscount=false;mocks.invoice.mockReset().mockResolvedValue('INV');mocks.pay.mockResolvedValue({result:{success:false,error:'TEST_STOP'},error:null});});
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
  it('preserves original rejection diagnostics without changing payment submission',async()=>{
    const diagnostic={code:'PGRST116',message:'raw API failure'};
    mocks.fetch.mockResolvedValue(preview('a','branch-a','warehouse-a'));
    mocks.pay.mockResolvedValue({result:null,error:'Friendly failure',diagnostic});
    const {result}=renderHook(()=>usePosOrder(input));
    await act(async()=>{expect(await result.current.completeSale()).toBe(false);});
    expect(mocks.pay).toHaveBeenCalledTimes(1);
    expect(mocks.show).toHaveBeenCalledWith('Friendly failure','error',{source:diagnostic,action:'pos_settlement_submit',branchId:'branch-a',entityType:'order',entityId:'a'});
  });
  it('stops before payment if the branch/order changes while invoice allocation is pending',async()=>{
    let resolve!: (value:string)=>void;
    mocks.invoice.mockReturnValue(new Promise<string>(yes=>{resolve=yes;}));
    mocks.fetch.mockResolvedValue(preview('a','branch-a','warehouse-a'));
    const {result,rerender}=renderHook(({branch})=>usePosOrder({...input,branchId:branch}),{initialProps:{branch:'branch-a'}});
    let completing!: Promise<boolean>;
    act(()=>{completing=result.current.completeSale();});
    await waitFor(()=>expect(mocks.invoice).toHaveBeenCalledTimes(1));
    mocks.base.activeOrderId='b';
    rerender({branch:'branch-b'});
    await act(async()=>{resolve('INV');expect(await completing).toBe(false);});
    expect(mocks.pay).not.toHaveBeenCalled();
  });
  it('never submits a foreign-order/branch preview to process_sale',async()=>{
    mocks.fetch.mockResolvedValue(preview('b','branch-b','foreign-warehouse'));
    const {result}=renderHook(()=>usePosOrder(input));
    await act(async()=>{expect(await result.current.completeSale()).toBe(false);});
    expect(mocks.pay).not.toHaveBeenCalled();
    expect(mocks.show).toHaveBeenCalledWith('SETTLEMENT_PREVIEW_SCOPE_MISMATCH','error');
  });
});

describe('approved linked-order discount', () => {
  it('persists only the header and refreshes the authoritative amount before payment', async () => {
    mocks.fetch.mockResolvedValueOnce(preview('a','branch-a','warehouse-a'));
    const discounted=preview('a','branch-a','warehouse-a');
    discounted.preview.discount_amount=20; discounted.preview.total=0;
    mocks.fetch.mockResolvedValueOnce(discounted);
    mocks.discount.mockResolvedValue({data:{success:true},error:null});
    const {result}=renderHook(()=>usePosOrder(input));
    await act(async()=>{await result.current.applyApprovedDiscount('amount',20,'approval-a');});
    expect(mocks.discount).toHaveBeenCalledWith({p_order_id:'a',p_discount_amount:20,p_approval_request_id:'approval-a'});
    expect(mocks.base.setPaidAmount).toHaveBeenCalledWith(0);
  });
  it('rejects a failed persistence instead of marking a local discount applied', async () => {
    mocks.fetch.mockResolvedValue(preview('a','branch-a','warehouse-a'));
    mocks.discount.mockResolvedValue({data:{success:false,error:'MANAGER_APPROVAL_REQUIRED'},error:null});
    const {result}=renderHook(()=>usePosOrder(input));
    await act(async()=>{await expect(result.current.applyApprovedDiscount('amount',20,'expired')).rejects.toThrow('MANAGER_APPROVAL_REQUIRED');});
    expect(mocks.base.setDiscountAmount).not.toHaveBeenCalled();
    expect(mocks.pay).not.toHaveBeenCalled();
  });
});


describe('direct linked-order discount', () => {
  const discounted = () => {
    const value = preview('a','branch-a','warehouse-a');
    value.preview.discount_amount=5; value.preview.total=15;
    return value;
  };
  it('preserves a saved discount when resuming with default local state', async () => {
    mocks.permissions.canDiscount=true;
    mocks.fetch.mockResolvedValue(discounted());
    const {result}=renderHook(()=>usePosOrder(input));
    await act(async()=>{await result.current.completeSale();});
    expect(mocks.discount).not.toHaveBeenCalled();
    expect(mocks.pay.mock.calls[0][0]).toMatchObject({p_discount_amount:5});
  });
  it('persists an explicit edit and re-reads the amount before payment', async () => {
    mocks.permissions.canDiscount=true;
    mocks.fetch.mockResolvedValueOnce(preview('a','branch-a','warehouse-a')).mockResolvedValueOnce(discounted());
    mocks.discount.mockResolvedValue({data:{success:true},error:null});
    const {result,rerender}=renderHook(()=>usePosOrder(input));
    act(()=>result.current.setDiscountAmount(5));
    mocks.base.discountAmount=5; rerender();
    await act(async()=>{await result.current.completeSale();});
    expect(mocks.discount).toHaveBeenCalledWith({p_order_id:'a',p_discount_amount:5,p_approval_request_id:null});
    expect(mocks.pay.mock.calls[0][0]).toMatchObject({p_discount_amount:5});
  });
  it('stops payment when saving an explicit discount fails', async () => {
    mocks.permissions.canDiscount=true;
    mocks.fetch.mockResolvedValue(preview('a','branch-a','warehouse-a'));
    mocks.discount.mockResolvedValue({data:{success:false,error:'DISCOUNT_FAILED'},error:null});
    const {result,rerender}=renderHook(()=>usePosOrder(input));
    act(()=>result.current.setDiscountAmount(5));
    mocks.base.discountAmount=5; rerender();
    await act(async()=>{expect(await result.current.completeSale()).toBe(false);});
    expect(mocks.pay).not.toHaveBeenCalled();
  });
  it('stops payment if the saved amount differs from the authoritative preview', async () => {
    mocks.permissions.canDiscount=true;
    mocks.fetch.mockResolvedValue(preview('a','branch-a','warehouse-a'));
    mocks.discount.mockResolvedValue({data:{success:true},error:null});
    const {result,rerender}=renderHook(()=>usePosOrder(input));
    act(()=>result.current.setDiscountAmount(5));
    mocks.base.discountAmount=5; rerender();
    await act(async()=>{expect(await result.current.completeSale()).toBe(false);});
    expect(mocks.pay).not.toHaveBeenCalled();
  });
});


describe('persisted settlement closure', () => {
  it('shows the completed receipt and resets workspace for a closed split order', async () => {
    mocks.fetch.mockResolvedValue(preview('a','branch-a','warehouse-a'));
    mocks.pay.mockResolvedValue({result:{success:true,sale_id:'sale-a',invoice_number:'INV',order_completed:true,remaining_unsent_quantity:0,payments:[{payment_method:'cash',amount:10},{payment_method:'card',amount:10}]},error:null});
    const {result}=renderHook(()=>usePosOrder(input));
    await act(async()=>{expect(await result.current.completeSale()).toBe(true);});
    expect(result.current.receiptOrderCompleted).toBe(true);
    expect(mocks.base.resetWorkspace).toHaveBeenCalledOnce();
    expect(mocks.show.mock.calls.some(call=>call[1]==='warning')).toBe(false);
  });
});
