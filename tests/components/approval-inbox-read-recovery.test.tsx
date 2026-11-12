import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalInbox } from '@/components/ApprovalInbox';
const m = vi.hoisted(() => ({
  allowed:true,user:{id:'operator',branch_id:'A'},rpc:vi.fn(),from:vi.fn(),
  callbacks:[] as Array<()=>void>,tables:[] as string[],statuses:[] as Array<(status:string)=>void>,tick:()=>{},
}));
vi.mock('@/context/AuthContext',()=>({useAuth:()=>({user:m.user})}));
vi.mock('@/lib/permissions',()=>({useCan:()=>()=>m.allowed}));
vi.mock('@/api',()=>({supabase:{rpc:m.rpc,from:m.from,
 channel:()=>{const c={on:(_kind:string,filter:{table:string},cb:()=>void)=>{m.tables.push(filter.table);m.callbacks.push(cb);return c;},subscribe:(cb:(status:string)=>void)=>{m.statuses.push(cb);}};return c;},removeChannel:vi.fn().mockResolvedValue(undefined),
}}));
const request=(reason='discount')=>({source_type:'manager_approval',source_id:'request',title:'discount',status:'pending',requested_by:'cashier',requested_at:new Date().toISOString(),payload:{reason}});
const response=(reason='discount')=>({data:[request(reason)],error:null});
beforeEach(()=>{
 vi.clearAllMocks();m.allowed=true;m.callbacks.length=0;m.tables.length=0;m.statuses.length=0;m.user={id:'operator',branch_id:'A'};
 m.rpc.mockResolvedValue({data:[],error:null});m.from.mockImplementation((table:string)=>{if(table!=='users')throw new Error('UNEXPECTED_PRINT_READ');return{select:()=>({in:()=>Promise.resolve({data:[{id:'cashier',full_name:'Requester'}],error:null})})};});
 const original=setInterval;vi.spyOn(window,'setInterval').mockImplementation((handler,ms,...args)=>{if(ms===30_000)m.tick=()=>{if(typeof handler==='function')handler(...args);};return original(handler,ms,...args);});
});
afterEach(()=>{cleanup();Reflect.deleteProperty(document,'hidden');vi.restoreAllMocks();});
describe('approval inbox without header printing alerts',()=>{
 it('removes the print alert button, reads and subscription while retaining approvals',async()=>{
  const screen=render(<ApprovalInbox ar={false}/>);await waitFor(()=>expect(m.rpc).toHaveBeenCalledOnce());
  expect(screen.queryByTestId('system-alerts-button')).not.toBeInTheDocument();expect(screen.queryByTestId('system-alerts-panel')).not.toBeInTheDocument();
  expect(screen.getByTestId('approval-inbox-button')).toBeInTheDocument();expect(m.from).not.toHaveBeenCalled();expect(m.tables).toEqual(['approval_requests']);
 });
 it('serializes approval realtime bursts and performs one trailing refresh',async()=>{
  let finish!:(x:unknown)=>void;m.rpc.mockReturnValueOnce(new Promise(done=>{finish=done;}));render(<ApprovalInbox ar={false}/>);
  await waitFor(()=>expect(m.rpc).toHaveBeenCalledOnce());await act(async()=>{for(let i=0;i<25;i++)m.callbacks[0]();});expect(m.rpc).toHaveBeenCalledOnce();
  await act(async()=>{finish({data:[],error:null});});await waitFor(()=>expect(m.rpc).toHaveBeenCalledTimes(2));
 });
 it('retains pending approvals when the next read fails',async()=>{
  m.rpc.mockResolvedValueOnce(response()).mockResolvedValue({data:null,error:{code:'57014'}});const screen=render(<ApprovalInbox ar={false}/>);
  await waitFor(()=>expect(screen.getByTestId('approval-inbox-count')).toHaveTextContent('1'));await act(async()=>{m.callbacks[0]();});
  await waitFor(()=>expect(m.rpc).toHaveBeenCalledTimes(2));expect(screen.getByTestId('approval-inbox-count')).toHaveTextContent('1');
 });
 it('recovers a failed read while realtime is healthy without any printing events',async()=>{
  m.rpc.mockResolvedValueOnce({data:[],error:null}).mockResolvedValueOnce({data:null,error:{code:'57014'}}).mockResolvedValue(response());
  const screen=render(<ApprovalInbox ar={false}/>);await waitFor(()=>expect(m.rpc).toHaveBeenCalledOnce());
  await act(async()=>{m.statuses[0]('SUBSCRIBED');});await waitFor(()=>expect(m.rpc).toHaveBeenCalledTimes(2));
  await act(async()=>{m.tick();});await waitFor(()=>expect(screen.getByTestId('approval-inbox-count')).toHaveTextContent('1'));
  await act(async()=>{m.tick();m.tick();});expect(m.rpc).toHaveBeenCalledTimes(3);expect(m.tables).toEqual(['approval_requests']);
 });
 it('pauses while hidden and reconciles on visibility and reconnection',async()=>{
  render(<ApprovalInbox ar={false}/>);await waitFor(()=>expect(m.rpc).toHaveBeenCalledOnce());
  Object.defineProperty(document,'hidden',{configurable:true,value:true});await act(async()=>{m.callbacks[0]();m.tick();});expect(m.rpc).toHaveBeenCalledOnce();
  Object.defineProperty(document,'hidden',{configurable:true,value:false});await act(async()=>{document.dispatchEvent(new Event('visibilitychange'));});await waitFor(()=>expect(m.rpc).toHaveBeenCalledTimes(2));
  await act(async()=>{m.statuses[0]('SUBSCRIBED');});await waitFor(()=>expect(m.rpc).toHaveBeenCalledTimes(3));
 });
 it.each(['branch','account'])('discards stale results after a %s switch, including StrictMode',async(kind)=>{
  let finish!:(x:unknown)=>void;m.rpc.mockReturnValueOnce(new Promise(done=>{finish=done;})).mockResolvedValue(response('New request'));
  const screen=render(<StrictMode><ApprovalInbox ar={false}/></StrictMode>);await waitFor(()=>expect(m.rpc).toHaveBeenCalledOnce());
  m.user=kind==='branch'?{id:'operator',branch_id:'B'}:{id:'other-reviewer',branch_id:'A'};screen.rerender(<StrictMode><ApprovalInbox ar={false}/></StrictMode>);
  await waitFor(()=>expect(screen.getByTestId('approval-inbox-count')).toHaveTextContent('1'));await act(async()=>{finish(response('Old request'));});
  fireEvent.click(screen.getByTestId('approval-inbox-button'));expect(screen.getByText(/New request/)).toBeInTheDocument();expect(screen.queryByText(/Old request/)).not.toBeInTheDocument();
 });
 it('reconciles requests created between the initial read and first subscription',async()=>{
  m.rpc.mockResolvedValueOnce({data:[],error:null}).mockResolvedValue(response());const screen=render(<ApprovalInbox ar={false}/>);
  await waitFor(()=>expect(m.rpc).toHaveBeenCalledOnce());expect(screen.queryByTestId('approval-inbox-count')).not.toBeInTheDocument();
  await act(async()=>{m.statuses[0]('SUBSCRIBED');});await waitFor(()=>expect(screen.getByTestId('approval-inbox-count')).toHaveTextContent('1'));
 });
 it('each reviewer independently sees the same pending request',async()=>{
  m.rpc.mockResolvedValue(response());const first=render(<ApprovalInbox ar={false}/>);await waitFor(()=>expect(first.getByTestId('approval-inbox-count')).toHaveTextContent('1'));
  first.unmount();m.user={id:'second-reviewer',branch_id:'A'};const second=render(<ApprovalInbox ar={false}/>);await waitFor(()=>expect(second.getByTestId('approval-inbox-count')).toHaveTextContent('1'));
  expect(m.rpc.mock.calls.every(call=>call[0]==='get_operational_approval_queue')).toBe(true);
 });
 it('polls only while disconnected or a read needs recovery',async()=>{
  render(<ApprovalInbox ar={false}/>);await waitFor(()=>expect(m.rpc).toHaveBeenCalledOnce());await act(async()=>{m.statuses[0]('CHANNEL_ERROR');m.tick();});expect(m.rpc).toHaveBeenCalledTimes(2);
  await act(async()=>{m.statuses[0]('SUBSCRIBED');});const calls=m.rpc.mock.calls.length;await act(async()=>{m.tick();m.tick();});expect(m.rpc).toHaveBeenCalledTimes(calls);
 });
 it('uses review permission and performs no reads for unauthorized users',async()=>{
  m.allowed=false;const screen=render(<ApprovalInbox ar={false}/>);await act(async()=>{await Promise.resolve();});
  expect(screen.queryByTestId('approval-inbox-button')).not.toBeInTheDocument();expect(m.rpc).not.toHaveBeenCalled();expect(m.from).not.toHaveBeenCalled();expect(m.tables).toEqual([]);
 });
 it('shows rejected decisions and retains the request',async()=>{
  m.rpc.mockImplementation((name:string)=>Promise.resolve(name==='decide_manager_approval'?{data:{success:false,error:'NOT_AUTHORIZED'},error:null}:response()));
  const screen=render(<ApprovalInbox ar={false}/>);await waitFor(()=>expect(screen.getByTestId('approval-inbox-count')).toHaveTextContent('1'));fireEvent.click(screen.getByTestId('approval-inbox-button'));fireEvent.click(screen.getByText('Approve'));
  await waitFor(()=>expect(screen.getByRole('alert')).toBeInTheDocument());expect(screen.getByTestId('approval-inbox-count')).toHaveTextContent('1');
 });
});
