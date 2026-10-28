import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalInbox } from '@/components/ApprovalInbox';
const m = vi.hoisted(() => ({
  allowed:true,user: { id: 'operator', branch_id: 'A' }, print: vi.fn(), or: vi.fn(), rpc: vi.fn(), callbacks: [] as Array<(payload?: {new?: Record<string, unknown>; old?: Record<string, unknown>}) => void>, statuses: [] as Array<(status: string) => void>,
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: m.user }) }));
vi.mock('@/lib/permissions', () => ({ useCan: () => () => m.allowed }));
vi.mock('@/api', () => ({ supabase: {
  rpc: m.rpc,
  from: () => { const q = { select: () => q, eq: () => q, in: () => q, or: (x: string) => { m.or(x); return q; }, gte: () => q, order: () => q, limit: m.print }; return q; },
  channel: () => { const c = { on: (_kind: string, _filter: unknown, cb: (payload?: {new?: Record<string, unknown>; old?: Record<string, unknown>}) => void) => { m.callbacks.push(cb); return c; }, subscribe: (cb: (status: string) => void) => { m.statuses.push(cb); } }; return c; },
  removeChannel: vi.fn().mockResolvedValue(undefined),
} }));
const alert = { id: 'job', kind: 'receipt', station_code: 'cashier', status: 'failed', attempts: 5, last_error: 'route', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
beforeEach(() => { vi.clearAllMocks();m.allowed=true; m.callbacks.length = 0; m.statuses.length = 0; m.user = { id: 'operator', branch_id: 'A' }; m.rpc.mockResolvedValue({ data: [], error: null }); m.print.mockResolvedValue({ data: [], error: null }); localStorage.clear(); });
afterEach(() => {vi.useRealTimers(); cleanup(); Reflect.deleteProperty(document, 'hidden'); vi.unstubAllGlobals(); });
describe('approval inbox read recovery', () => {
  it('filters ordinary successes before the server limit and serializes realtime bursts', async () => {
    let finish!: (x: unknown) => void;
    m.print.mockReturnValueOnce(new Promise(done => { finish = done; }));
    render(<ApprovalInbox ar={false} />);
    await waitFor(() => expect(m.print).toHaveBeenCalledOnce());
    expect(m.or).toHaveBeenCalledWith('status.eq.failed,and(status.eq.submitted,attempts.gt.1)');
    await act(async () => { for (let i = 0; i < 25; i++) m.callbacks[1](); });
    expect(m.print).toHaveBeenCalledOnce();
    await act(async () => { finish({ data: [], error: null }); });
    await waitFor(() => expect(m.print).toHaveBeenCalledTimes(2));
  });
  it('does not erase an existing alert when its next read fails', async () => {
    m.print.mockResolvedValueOnce({ data: [alert], error: null }).mockResolvedValue({ data: null, error: { code: '57014' } });
    const screen = render(<ApprovalInbox ar={false} />);
    await waitFor(() => expect(screen.getByTestId('system-alerts-count')).toHaveTextContent('1'));
    await act(async () => { m.callbacks[1](); });
    await waitFor(() => expect(m.print).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('system-alerts-count')).toHaveTextContent('1');
  });
  it('normal print bursts perform zero approval or alert rereads', async () => {
    render(<ApprovalInbox ar={false} />);
    await waitFor(() => expect(m.print).toHaveBeenCalledOnce());
    await act(async () => { for (let i=0;i<100;i++) m.callbacks[1]({new:{id:'normal-'+i,status:'submitted',attempts:1},old:{id:'normal-'+i}}); });
    expect(m.print).toHaveBeenCalledOnce();
    expect(m.rpc).toHaveBeenCalledOnce();
    await act(async () => { m.callbacks[0](); });
    await waitFor(() => expect(m.rpc).toHaveBeenCalledTimes(2));
    expect(m.print).toHaveBeenCalledOnce();
  });
  it('retries failed alert reads on the next event before suppressing normal jobs', async () => {
    m.print.mockRejectedValueOnce(new Error('network')).mockResolvedValue({data:[alert],error:null});
    const screen=render(<ApprovalInbox ar={false} />);
    await waitFor(() => expect(m.print).toHaveBeenCalledOnce());
    await act(async () => {m.callbacks[1]({new:{id:'ordinary',status:'submitted',attempts:1}});});
    await waitFor(() => expect(screen.getByTestId('system-alerts-count')).toHaveTextContent('1'));
    expect(m.print).toHaveBeenCalledTimes(2);expect(m.rpc).toHaveBeenCalledOnce();
    await act(async () => {m.callbacks[1]({new:{id:'another-ordinary',status:'submitted',attempts:1}});});
    expect(m.print).toHaveBeenCalledTimes(2);
  });
  it('retries an unavailable approval list without unnecessarily rereading print alerts', async () => {
    m.rpc.mockResolvedValueOnce({data:null,error:{code:'57014'}}).mockResolvedValue({data:[],error:null});
    render(<ApprovalInbox ar={false} />);
    await waitFor(() => expect(m.print).toHaveBeenCalledOnce());
    await act(async () => {m.callbacks[1]({new:{id:'ordinary',status:'submitted',attempts:1}});});
    await waitFor(() => expect(m.rpc).toHaveBeenCalledTimes(2));
    expect(m.print).toHaveBeenCalledOnce();
    await act(async () => {m.callbacks[1]({new:{id:'another-ordinary',status:'submitted',attempts:1}});});
    expect(m.rpc).toHaveBeenCalledTimes(2);
  });
  it('failures and recovery refresh alerts without querying approvals', async () => {
    m.print.mockResolvedValue({data:[alert],error:null});
    const screen=render(<ApprovalInbox ar={false} />);
    await waitFor(() => expect(screen.getByTestId('system-alerts-count')).toHaveTextContent('1'));
    await act(async () => {m.callbacks[1]({new:{...alert,status:'submitted',attempts:2},old:{id:alert.id}});});
    await waitFor(() => expect(m.print).toHaveBeenCalledTimes(2));
    expect(m.rpc).toHaveBeenCalledOnce();
    // Delete or a formerly known alert leaving the relevant states must reconcile.
    m.print.mockResolvedValue({data:[],error:null});
    await act(async () => {m.callbacks[1]({new:{id:alert.id,status:'pending',attempts:1},old:{id:alert.id}});});
    await waitFor(() => expect(screen.queryByTestId('system-alerts-count')).not.toBeInTheDocument());
  });
  it('pauses reads while hidden and reconciles on return and reconnect', async () => {
    render(<ApprovalInbox ar={false} />);
    await waitFor(() => expect(m.print).toHaveBeenCalledOnce());
    Object.defineProperty(document,'hidden',{configurable:true,value:true});
    await act(async () => {m.callbacks[0]();m.callbacks[1]({new:alert});});
    expect(m.print).toHaveBeenCalledOnce();expect(m.rpc).toHaveBeenCalledOnce();
    Object.defineProperty(document,'hidden',{configurable:true,value:false});
    await act(async () => {document.dispatchEvent(new Event('visibilitychange'));});
    await waitFor(() => expect(m.print).toHaveBeenCalledTimes(2));
    await act(async () => {m.statuses[0]('SUBSCRIBED');m.statuses[0]('SUBSCRIBED');});
    await waitFor(() => expect(m.print).toHaveBeenCalledTimes(3));
    expect(m.rpc).toHaveBeenCalledTimes(3);
  });
  it('discards results from the previous branch and works in StrictMode', async () => {
    let finish!: (x: unknown) => void;
    m.print.mockReturnValueOnce(new Promise(done => { finish = done; }));
    const screen = render(<StrictMode><ApprovalInbox ar={false} /></StrictMode>);
    await waitFor(() => expect(m.print).toHaveBeenCalledOnce());
    m.user = { id: 'operator', branch_id: 'B' };
    screen.rerender(<StrictMode><ApprovalInbox ar={false} /></StrictMode>);
    await waitFor(() => expect(m.print).toHaveBeenCalledTimes(2));
    await act(async () => { finish({ data: [alert], error: null }); });
    expect(screen.queryByTestId('system-alerts-count')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('system-alerts-button'));
    expect(screen.getByText('No important notifications')).toBeInTheDocument();
  });

  it('reconciles a request created between the initial read and first subscription',async()=>{
    m.rpc.mockResolvedValueOnce({data:[],error:null}).mockResolvedValue({data:[{source_type:'manager_approval',source_id:'request',title:'discount',status:'pending',requested_by:'cashier',requested_at:new Date().toISOString(),payload:{reason:'discount'}}],error:null});
    const screen=render(<ApprovalInbox ar={false}/>);
    await waitFor(()=>expect(m.rpc).toHaveBeenCalledOnce());
    expect(screen.queryByTestId('approval-inbox-count')).not.toBeInTheDocument();
    await act(async()=>{m.statuses[0]('SUBSCRIBED');});
    await waitFor(()=>expect(screen.getByTestId('approval-inbox-count')).toHaveTextContent('1'));
    expect(m.print).toHaveBeenCalledOnce();
  });
  it('each authorized reviewer independently sees the same pending request',async()=>{
    m.rpc.mockResolvedValue({data:[{source_type:'manager_approval',source_id:'request',title:'discount',status:'pending',requested_by:'cashier',payload:{}}],error:null});
    const first=render(<ApprovalInbox ar={false}/>);
    await waitFor(()=>expect(first.getByTestId('approval-inbox-count')).toHaveTextContent('1'));
    first.unmount();m.user={id:'second-reviewer',branch_id:'A'};
    const second=render(<ApprovalInbox ar={false}/>);
    await waitFor(()=>expect(second.getByTestId('approval-inbox-count')).toHaveTextContent('1'));
    expect(m.rpc.mock.calls.every(call=>call[0]==='get_operational_approval_queue')).toBe(true);
  });
  it('retries only approval reads while disconnected and stops polling after subscription recovers',async()=>{
    let tick!:()=>void;const original=setInterval;
    vi.spyOn(window,'setInterval').mockImplementation((handler,ms,...args)=>{if(ms===30_000){tick=()=>{if(typeof handler==='function')handler(...args);};return original(handler,ms,...args);}return original(handler,ms,...args);});
    render(<ApprovalInbox ar={false}/>);await waitFor(()=>expect(m.rpc).toHaveBeenCalledOnce());
    await act(async()=>{m.statuses[0]('CHANNEL_ERROR');tick();});
    expect(m.rpc).toHaveBeenCalledTimes(2);expect(m.print).toHaveBeenCalledOnce();
    await act(async()=>{m.statuses[0]('SUBSCRIBED');});
    const calls=m.rpc.mock.calls.length;
    await act(async()=>{tick();tick();tick();});
    expect(m.rpc).toHaveBeenCalledTimes(calls);expect(m.print).toHaveBeenCalledOnce();
  });
  it('uses review permission rather than a privileged-looking user identity',async()=>{
    m.allowed=false;m.user={id:'named-manager',branch_id:'A'};
    const screen=render(<ApprovalInbox ar={false}/>);
    await act(async()=>{await Promise.resolve();});
    expect(screen.queryByTestId('approval-inbox-button')).not.toBeInTheDocument();
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it('surfaces rejected decisions and retains the pending request',async()=>{
    m.rpc.mockImplementation((name:string)=>Promise.resolve(name==='decide_manager_approval'?{data:{success:false,error:'NOT_AUTHORIZED'},error:null}:{data:[{source_type:'manager_approval',source_id:'request',title:'discount',status:'pending',requested_by:'cashier',payload:{}}],error:null}));
    const screen=render(<ApprovalInbox ar={false}/>);await waitFor(()=>expect(screen.getByTestId('approval-inbox-count')).toHaveTextContent('1'));
    fireEvent.click(screen.getByTestId('approval-inbox-button'));
    fireEvent.click(screen.getByText('Approve'));
    await waitFor(()=>expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByTestId('approval-inbox-count')).toHaveTextContent('1');
  });
});
