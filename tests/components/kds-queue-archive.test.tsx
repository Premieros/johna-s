import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { KitchenDisplayPage } from '@/features/inventory/pages/KitchenDisplayPage';
const mocks=vi.hoisted(()=>({ rpc:vi.fn(), history:vi.fn(), setStatus:vi.fn(), context:vi.fn(), finishEmpty:vi.fn(), branch:'a',user:{id:'u'},can:vi.fn(()=>true) }));
vi.mock('@/api',()=>({supabase:{rpc:mocks.rpc}}));
vi.mock('@/api/domains/catalog',()=>({catalog:{getKitchenOrderContext:mocks.context,getKitchenCompletedHistory:mocks.history,setKitchenStatus:mocks.setStatus,finishEmptyKitchenOrder:mocks.finishEmpty}}));
vi.mock('@/context/AuthContext',()=>({useAuth:()=>({user:mocks.user})}));
vi.mock('@/context/LanguageContext',()=>({useLanguage:()=>({lang:'en'})}));
vi.mock('@/lib/useBranchFilter',()=>({useBranchFilter:()=>mocks.branch}));
vi.mock('@/lib/permissions',()=>({useCan:()=>mocks.can}));
vi.mock('@/features/pos/services/posRealtime',()=>({subscribePosRealtime:()=>()=>{}}));
vi.mock('@/components/design/DesignSurface',()=>({DesignSurface:({children}:{children:React.ReactNode})=><div>{children}</div>,DesignPageHeader:()=>null}));
const queueRow=(id:string, seconds:number)=>({order_id:id,order_number:id,station:'main',kitchen_status:'sent',created_at:new Date(Date.now()-seconds*1000).toISOString(),elapsed_seconds:seconds,items:[]});
beforeEach(()=>{
 mocks.branch='a';mocks.user={id:'u'};mocks.can.mockReset().mockReturnValue(true);
 mocks.rpc.mockReset().mockImplementation(async(name:string)=>({data:name==='get_kitchen_queue'?[queueRow('RECENT',60),queueRow('OLDER',2400)]:[],error:null}));
 mocks.context.mockReset().mockResolvedValue({data:[],error:null});
 mocks.history.mockReset().mockResolvedValue({data:{rows:[{order_id:'h',order_number:'DONE',kitchen_status:'served',updated_at:new Date().toISOString(),table_name:'Table 1'}],count:1},error:null});
 mocks.setStatus.mockReset().mockResolvedValue(undefined);
 mocks.finishEmpty.mockReset().mockResolvedValue({data:{success:true,changed:true},error:null});
});
afterEach(()=>vi.useRealTimers());
describe('KDS 40-minute display archive',()=>{
 it('separates active and expired cards without changing statuses and reads completed history lazily',async()=>{
  render(<KitchenDisplayPage/>);
  expect(await screen.findByText('#RECENT')).toBeVisible();
  expect(screen.queryByText('#OLDER')).not.toBeInTheDocument();
  expect(mocks.history).not.toHaveBeenCalled(); expect(mocks.setStatus).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('tab',{name:/Over 40 minutes/}));
  expect(screen.getByText('#OLDER')).toBeVisible(); expect(screen.queryByText('#RECENT')).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Start Cooking'})).toBeVisible();
  fireEvent.click(screen.getByRole('tab',{name:'Completed'}));
  expect(await screen.findByText('#DONE')).toBeVisible();
  expect(mocks.history).toHaveBeenCalledTimes(1); expect(mocks.setStatus).not.toHaveBeenCalled();
  expect(screen.queryByRole('button',{name:'Start Cooking'})).not.toBeInTheDocument();
 });
 it('uses the explicit administrative cleanup for a voided empty order rather than serving it',async()=>{
  let finished=false;
  mocks.rpc.mockImplementation(async(name:string)=>({data:name==='get_kitchen_queue'?(finished?[]:[{...queueRow('VOIDED',2500),notes:'- Kitchen void: 1x Product'}]):[],error:null}));
  mocks.finishEmpty.mockImplementation(async()=>{finished=true;return {data:{success:true,changed:true},error:null};});
  render(<KitchenDisplayPage/>);await waitFor(()=>expect(screen.getByRole('tab',{name:/Over 40 minutes/})).toHaveTextContent('(1)'));
  fireEvent.click(screen.getByRole('tab',{name:/Over 40 minutes/}));fireEvent.click(screen.getByRole('button',{name:'Finish empty voided order'}));
  await waitFor(()=>expect(screen.queryByText('#VOIDED')).not.toBeInTheDocument());
  expect(mocks.finishEmpty).toHaveBeenCalledWith({p_order_id:'VOIDED',p_branch_id:'a'});expect(mocks.setStatus).not.toHaveBeenCalled();
 });
 it('moves a card at exactly 40 minutes using a local timer without fetching or serving',async()=>{
  vi.useFakeTimers(); mocks.rpc.mockImplementation(async(name:string)=>({data:name==='get_kitchen_queue'?[queueRow('BOUNDARY',2399)]:[],error:null}));
  render(<KitchenDisplayPage/>); await act(async()=>{await Promise.resolve();await Promise.resolve();});
  expect(screen.getByText('#BOUNDARY')).toBeVisible();const count=mocks.rpc.mock.calls.length;
  await act(async()=>{vi.advanceTimersByTime(1000);});
  expect(screen.queryByText('#BOUNDARY')).not.toBeInTheDocument();expect(mocks.rpc).toHaveBeenCalledTimes(count);expect(mocks.setStatus).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('tab',{name:/Over 40 minutes/}));expect(screen.getByText('#BOUNDARY')).toBeVisible();
 });
 it('shows completed read errors and retry, with no misleading successful empty history',async()=>{
  mocks.history.mockResolvedValueOnce({data:null,error:{message:'NETWORK_ERROR'}});
  render(<KitchenDisplayPage/>); await screen.findByText('#RECENT');fireEvent.click(screen.getByRole('tab',{name:'Completed'}));
  expect(await screen.findByRole('alert')).toBeVisible();expect(screen.queryByText(/No completed orders available/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Retry'}));expect(await screen.findByText('#DONE')).toBeVisible();
 });
 it('discards completed history from an old branch and does not load history without KDS view permission',async()=>{
  let resolveOld:(value:unknown)=>void=()=>{};mocks.history.mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;}));
  const page=render(<KitchenDisplayPage/>);await screen.findByText('#RECENT');fireEvent.click(screen.getByRole('tab',{name:'Completed'}));
  await waitFor(()=>expect(mocks.history).toHaveBeenCalledTimes(1));mocks.branch='b';page.rerender(<KitchenDisplayPage/>);
  expect(await screen.findByText('#DONE')).toBeVisible();await act(async()=>resolveOld({data:{rows:[{order_id:'old',order_number:'FOREIGN',kitchen_status:'served',updated_at:new Date().toISOString()}],count:1},error:null}));
  expect(screen.queryByText('#FOREIGN')).not.toBeInTheDocument();
  mocks.can.mockReturnValue(false);page.rerender(<KitchenDisplayPage/>);expect(screen.queryByTestId('kds-completed-history')).not.toBeInTheDocument();
 });
});
