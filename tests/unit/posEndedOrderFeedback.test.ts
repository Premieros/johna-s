import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),select:vi.fn(),eq:vi.fn(),maybeSingle:vi.fn()}));
vi.mock('@/api',()=>({supabase:{rpc:mocks.rpc,from:mocks.from},pos:{}}));
import {fetchOrderForWorkspace} from '@/features/pos/services/posOrders';
beforeEach(()=>{vi.resetAllMocks();mocks.rpc.mockResolvedValue({data:{success:false,error:'ORDER_NOT_FOUND'}});mocks.from.mockReturnValue(mocks);mocks.select.mockReturnValue(mocks);mocks.eq.mockReturnValue(mocks);});
describe('ended order workspace feedback',()=>{
 it.each([['completed','ORDER_CLOSED'],['cancelled','ORDER_CANCELLED']])('explains %s without hydrating the order',async(status,code)=>{
  mocks.maybeSingle.mockResolvedValue({data:{status}});
  await expect(fetchOrderForWorkspace('order-id')).rejects.toThrow(code);
  expect(mocks.from).toHaveBeenCalledTimes(1);expect(mocks.select).toHaveBeenCalledWith('status');expect(mocks.eq).toHaveBeenCalledWith('id','order-id');
 });
 it('never reads an order after permission rejection',async()=>{
  mocks.rpc.mockResolvedValue({data:{success:false,error:'PERMISSION_DENIED'}});
  await expect(fetchOrderForWorkspace('order-id')).rejects.toThrow('PERMISSION_DENIED');expect(mocks.from).not.toHaveBeenCalled();
 });
 it.each([{data:null},{data:null,error:{message:'unavailable'}},{data:{status:'open'}}])('preserves unavailable response if no ended state is proved',async(result)=>{
  mocks.maybeSingle.mockResolvedValue(result);
  await expect(fetchOrderForWorkspace('order-id')).rejects.toThrow('ORDER_NOT_FOUND');
 });
 it('keeps successful resume to its existing single payload read',async()=>{
  mocks.rpc.mockResolvedValue({data:{success:true}});mocks.maybeSingle.mockResolvedValue({data:{id:'order-id',status:'open',order_items:[]}});
  await expect(fetchOrderForWorkspace('order-id')).resolves.toMatchObject({order:{id:'order-id'}});
  expect(mocks.from).toHaveBeenCalledTimes(1);expect(mocks.select).not.toHaveBeenCalledWith('status');
 });
});

it.each([['completed','ORDER_CLOSED'],['cancelled','ORDER_CANCELLED']])('rejects %s that closes between access approval and hydration',async(status,code)=>{
 mocks.rpc.mockResolvedValue({data:{success:true}});mocks.maybeSingle.mockResolvedValue({data:{id:'order-id',status,order_items:[]}});
 await expect(fetchOrderForWorkspace('order-id')).rejects.toThrow(code);
});
