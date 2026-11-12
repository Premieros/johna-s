import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SupportSessionView from '@/features/support/SupportSessionView';
import type { SupportSession } from '@/features/support/protocol';
const m = vi.hoisted(() => ({ user: {id:'employee'}, navigate:vi.fn(), capture:vi.fn(), audit:vi.fn(), change:vi.fn(), read:vi.fn(), signals:vi.fn(), create:vi.fn() }));
vi.mock('@/context/AuthContext',()=>({useAuth:()=>({user:m.user})}));
vi.mock('@/lib/activeBranch',()=>({useActiveBranchId:()=>['branch',vi.fn()]}));
vi.mock('@/lib/permissions',()=>({useCan:()=>()=>true}));
vi.mock('react-router-dom',()=>({useNavigate:()=>m.navigate,useLocation:()=>({pathname:'/dashboard'})}));
vi.mock('@/features/support/peer',()=>({createSupportPeer:()=>m.create(),captureOwnTab:()=>m.capture()}));
vi.mock('@/features/support/service',()=>({audit:(...args:unknown[])=>m.audit(...args),changeSession:(...args:unknown[])=>m.change(...args),readSession:()=>m.read(),readSignals:()=>m.signals(),signal:vi.fn()}));
const session: SupportSession={id:'session',branch_id:'branch',requester_id:'employee',operator_id:'manager',requester_name:'Employee',operator_name:'Manager',branch_name:'Branch',state:'claimed',created_at:new Date().toISOString(),expires_at:new Date(Date.now()+1200000).toISOString()};
let connection: RTCPeerConnection; let dc: RTCDataChannel; let stop: ReturnType<typeof vi.fn>;
beforeEach(()=>{
  vi.clearAllMocks();
  connection={close:vi.fn(),getTransceivers:()=>[],addTrack:vi.fn()} as unknown as RTCPeerConnection;
  dc={readyState:'open',send:vi.fn(),close:vi.fn()} as unknown as RTCDataChannel;
  stop=vi.fn();
  m.create.mockReturnValue(connection);m.read.mockResolvedValue(session);m.signals.mockResolvedValue([]);m.audit.mockResolvedValue(undefined);m.change.mockResolvedValue({...session,state:'sharing'});
  m.capture.mockResolvedValue({getTracks:()=>[{stop}],getVideoTracks:()=>[{stop}]} as unknown as MediaStream);
});
function incoming(data:string){act(()=>{dc.onmessage?.({data} as MessageEvent);});}
function attach(){act(()=>{connection.ondatachannel?.({channel:dc} as RTCDataChannelEvent);});}
describe('employee support consent boundary',()=>{
  it('never captures automatically and never accepts commands before explicit control consent',async()=>{
    const view=render(<SupportSessionView initial={session} viewer={false} onEnd={vi.fn()}/>);attach();
    expect(m.capture).not.toHaveBeenCalled();incoming('{"type":"navigate","path":"/reports"}');expect(m.navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:/أوافق على المشاهدة/}));await waitFor(()=>expect(m.capture).toHaveBeenCalledOnce());
    await waitFor(()=>expect(screen.queryByRole('button',{name:/أوافق على المشاهدة/})).not.toBeInTheDocument());
    incoming('{"type":"navigate","path":"/reports"}');expect(m.navigate).not.toHaveBeenCalled();
    incoming('request-control');fireEvent.click(screen.getByRole('button',{name:'السماح بالتحكم'}));
    await waitFor(()=>expect(dc.send).toHaveBeenCalledWith('control-granted'));
    incoming('{"type":"navigate","path":"/reports"}');expect(m.navigate).toHaveBeenCalledWith('/reports');
    m.navigate.mockClear();incoming('{"type":"navigate","path":"/pos"}');expect(m.navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'إيقاف التحكم والإبقاء على المشاهدة'}));
    incoming('{"type":"navigate","path":"/reports"}');expect(m.navigate).not.toHaveBeenCalled();
    view.unmount();expect(stop).toHaveBeenCalled();
  });
  it('stops locally before relying on a server close request',()=>{
    const end=vi.fn();render(<SupportSessionView initial={session} viewer={false} onEnd={end}/>);attach();
    fireEvent.click(screen.getByRole('button',{name:'إنهاء الجلسة فورًا'}));
    expect(dc.close).toHaveBeenCalledOnce();expect(connection.close).toHaveBeenCalledOnce();expect(end).toHaveBeenCalledOnce();
    incoming('{"type":"navigate","path":"/reports"}');expect(m.navigate).not.toHaveBeenCalled();
  });
});
