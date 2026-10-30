import {act,renderHook,waitFor} from '@testing-library/react';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({fetch:vi.fn(),enqueue:vi.fn(),show:vi.fn(),base:{
 activeOrderId:'a',activeOrderNumber:'O-a' as string|null,orderLoading:false,
 tableId:'t27',activeTable:{id:'t27',branch_id:'branch-a',name:'27'} as {id:string;branch_id:string;name:string}|null,
 orderType:'dine_in',guestCount:2,customerId:'',openCheckPrintStateReady:true,
 cart:[{product:{id:'p',name:'Coffee'},modifiers:[]}],
}}));
vi.mock('@/api',()=>({supabase:{},floorPlan:{}}));
vi.mock('@/context/LanguageContext',()=>({useLanguage:()=>({lang:'en',t:(s:string)=>s})}));
vi.mock('@/components/Toast',()=>({useToast:()=>({show:state.show})}));
vi.mock('@/features/pos/hooks/usePosPermissions',()=>({usePosPermissions:()=>({canEditOrder:false,canReprint:false})}));
vi.mock('@/features/pos/hooks/usePosOrderBase',()=>({usePosOrder:()=>state.base}));
vi.mock('@/features/pos/services/settlementPreview',()=>({fetchOrderSettlementPreview:state.fetch}));
vi.mock('@/features/pos/services/cloudPrint',()=>({enqueueCloudOpenOrderPrint:state.enqueue}));
vi.mock('@/features/pos/services/payment',()=>({nextInvoiceNumber:vi.fn(),createSaleOperationKey:vi.fn(),processSaleForOrder:vi.fn()}));
import {usePosOrder,type UsePosOrderInput} from '@/features/pos/hooks/usePosOrder';
const input={branchId:'branch-a',branchName:'Branch A',products:[],customers:[],effSettings:{currency:'EGP',store_name:'Premier'}} as unknown as UsePosOrderInput;
const ready=()=>({preview:{success:true,order_id:'a',branch_id:'branch-a',items:[{product_id:'p',quantity:1,unit_name:'piece',unit_price:10,total:10}],subtotal:10,discount_amount:0,tax_amount:0,total:10,has_payable_items:true},error:null});
beforeEach(()=>{vi.clearAllMocks();state.base.activeOrderId='a';state.base.activeOrderNumber='O-a';state.base.orderLoading=false;state.base.tableId='t27';state.base.activeTable={id:'t27',branch_id:'branch-a',name:'27'};state.fetch.mockResolvedValue(ready());state.enqueue.mockResolvedValue({accepted:true});});
describe('customer open-check metadata readiness',()=>{
 it('queues the real order identity, table and product name in text and template',async()=>{
  const {result}=renderHook(()=>usePosOrder(input));
  await act(async()=>{await result.current.printReceipt();});
  expect(state.enqueue).toHaveBeenCalledOnce();
  const queued=state.enqueue.mock.calls[0][0];
  expect(queued.orderId).toBe('a');
  expect(queued.payload.text).toContain('Table: 27');expect(queued.payload.text).toContain('Order: O-a');
  expect(queued.payload.text).toContain('Coffee');expect(queued.payload.text).not.toContain('ORDER-');
  expect(queued.payload.template.meta).toContainEqual(expect.objectContaining({label:'Table',value:'27'}));
 });
 it('does not load a print preview or consume a print authorization while workspace metadata is loading',async()=>{
  state.base.orderLoading=true;state.base.activeOrderNumber=null;
  const {result}=renderHook(()=>usePosOrder(input));
  await act(async()=>{await result.current.printReceipt();});
  expect(state.fetch).not.toHaveBeenCalled();expect(state.enqueue).not.toHaveBeenCalled();
 });
 it('never prints a stale table name after switching tables',async()=>{
  state.base.activeTable={id:'t29',branch_id:'branch-a',name:'29'};
  const {result,rerender}=renderHook(()=>usePosOrder(input));
  await act(async()=>{await result.current.printReceipt();});
  expect(state.enqueue).not.toHaveBeenCalled();
  state.base.activeTable={id:'t27',branch_id:'branch-a',name:'27'};rerender();
  await act(async()=>{await result.current.printReceipt();});
  expect(state.enqueue.mock.calls[0][0].payload.text).toContain('Table: 27');
  expect(state.enqueue.mock.calls[0][0].payload.text).not.toContain('Table: 29');
 });
 it('does not enqueue an old preview when the order changes during the read',async()=>{
  let finish!: (value:ReturnType<typeof ready>)=>void;
  state.fetch.mockImplementationOnce(()=>new Promise(done=>{finish=done;}));
  const {result,rerender}=renderHook(()=>usePosOrder(input));let printing!:Promise<void>;
  act(()=>{printing=result.current.printReceipt();});
  await waitFor(()=>expect(state.fetch).toHaveBeenCalledOnce());
  state.base.activeOrderId='b';state.base.activeOrderNumber='O-b';rerender();
  await act(async()=>{finish(ready());await printing;});
  expect(state.enqueue).not.toHaveBeenCalled();
 });
 it('does not enqueue captured table metadata after the same order changes table during preview',async()=>{
  let finish!: (value:ReturnType<typeof ready>)=>void;
  state.fetch.mockImplementationOnce(()=>new Promise(done=>{finish=done;}));
  const {result,rerender}=renderHook(()=>usePosOrder(input));let printing!:Promise<void>;
  act(()=>{printing=result.current.printReceipt();});
  await waitFor(()=>expect(state.fetch).toHaveBeenCalledOnce());
  state.base.tableId='t29';state.base.activeTable={id:'t29',branch_id:'branch-a',name:'29'};rerender();
  await act(async()=>{finish(ready());await printing;});
  expect(state.enqueue).not.toHaveBeenCalled();
 });

});

it('never queues an open check while any item remains unsent',async()=>{
  const value=ready();value.preview={...value.preview,unsent_quantity:1} as typeof value.preview;state.fetch.mockResolvedValue(value);
  const {result}=renderHook(()=>usePosOrder(input));
  await act(async()=>{await result.current.printReceipt();});
  expect(state.enqueue).not.toHaveBeenCalled();
});
