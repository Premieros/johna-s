import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),read:vi.fn(),remove:vi.fn()}));
vi.mock('@/api',()=>({supabase:{rpc:mocks.rpc,from:()=>({select:()=>({eq:()=>({maybeSingle:mocks.read})})}),channel:()=>({on(){return this;},subscribe(){return this;}}),removeChannel:mocks.remove}}));
import {CashierDiscountApprovalCard} from '@/features/pos/components/checkout/CashierDiscountApprovalCard';
const decision={id:'request-1',status:'approved',payload:{discount_type:'amount',requested_value:320,discount_amount:320},expires_at:'2099-01-01T00:00:00Z'};
function request(){fireEvent.change(screen.getByPlaceholderText('Discount'),{target:{value:'320'}});fireEvent.change(screen.getByPlaceholderText('Reason (required)'),{target:{value:'Offer'}});fireEvent.click(screen.getByRole('button',{name:'Send approval request'}));}
beforeEach(()=>{mocks.rpc.mockReset().mockResolvedValue({data:{success:true,request_id:'request-1'},error:null});mocks.read.mockReset().mockResolvedValue({data:decision,error:null});});
describe('existing discount approval recovery',()=>{
 it('retries applying the same approved value without creating another request',async()=>{
  const apply=vi.fn().mockRejectedValueOnce(new Error('ORDER_OPERATOR_REQUIRED')).mockResolvedValue(undefined);
  render(<CashierDiscountApprovalCard subtotal={995} currentType="amount" onApproved={apply} ar={false} canDirectDiscount={false} orderId="order-1"/>);request();
  await screen.findByText('ORDER_OPERATOR_REQUIRED');expect(apply).toHaveBeenCalledTimes(1);expect(mocks.rpc).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button',{name:'Retry the same approval'}));
  await screen.findByRole('button',{name:'Approved'});expect(apply).toHaveBeenCalledTimes(2);expect(apply.mock.calls[1]).toEqual(['amount',320,'request-1']);expect(mocks.rpc).toHaveBeenCalledTimes(1);
 });
 it('shows a read error and rechecks the existing request before applying it',async()=>{
  mocks.read.mockResolvedValueOnce({data:null,error:{message:'offline'}}).mockResolvedValue({data:decision,error:null});const apply=vi.fn();
  render(<CashierDiscountApprovalCard subtotal={995} currentType="amount" onApproved={apply} ar={false} canDirectDiscount={false} orderId="order-1"/>);request();
  await screen.findByRole('alert');expect(apply).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Retry the same approval'}));
  await waitFor(()=>expect(apply).toHaveBeenCalledOnce());expect(mocks.rpc).toHaveBeenCalledTimes(1);
 });
 it('never applies an expired approval',async()=>{
  mocks.read.mockResolvedValue({data:{...decision,expires_at:'2020-01-01T00:00:00Z'},error:null});const apply=vi.fn();
  render(<CashierDiscountApprovalCard subtotal={995} currentType="amount" onApproved={apply} ar={false} canDirectDiscount={false} orderId="order-1"/>);request();await screen.findByText(/Approval expired/);expect(apply).not.toHaveBeenCalled();
 });
 it('does not apply a delayed decision after the order card unmounts',async()=>{
  let resolve!:(value:unknown)=>void;mocks.read.mockImplementation(()=>new Promise(done=>{resolve=done;}));const apply=vi.fn();
  const view=render(<CashierDiscountApprovalCard subtotal={995} currentType="amount" onApproved={apply} ar={false} canDirectDiscount={false} orderId="order-1"/>);request();await waitFor(()=>expect(mocks.read).toHaveBeenCalled());view.unmount();resolve({data:decision,error:null});await Promise.resolve();expect(apply).not.toHaveBeenCalled();
 });
});
