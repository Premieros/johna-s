import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrinterSettingsPanel } from '@/features/pos/components/settings/PrinterSettingsPanel';
const m=vi.hoisted(()=>({read:vi.fn(), user:{id:'operator',branch_id:'A'},branches:[{id:'A',name:'A'},{id:'B',name:'B'}]}));
vi.mock('@/context/AuthContext',()=>({useAuth:()=>({user:m.user})}));
vi.mock('@/lib/permissions',()=>({useCan:()=>()=>true}));
vi.mock('@/hooks/useBranches',()=>({useBranches:()=>({branches:m.branches})}));
vi.mock('@/context/LanguageContext',()=>({useLanguage:()=>({lang:'en'})}));
vi.mock('@/components/Toast',()=>({useToast:()=>({show:vi.fn()})}));
vi.mock('@/api/domains/catalog',()=>({catalog:{getKitchenStationAssignments:vi.fn().mockResolvedValue({data:[],error:null})}}));
vi.mock('@/features/pos/services/cloudPrint',()=>({listCloudPrintQueueSummary:m.read,getCloudPrintAgentBranchId:()=>'',isCloudPrintAgentEnabled:()=>true,saveCloudPrintAgentConfig:vi.fn()}));
vi.mock('@/features/pos/services/localPrintAgent',()=>({
  applyLocalPrinterRoutes:vi.fn(),executeCashDrawerKick:vi.fn(),executeSilentPrintDetailed:vi.fn(),
  getAvailablePrinters:vi.fn().mockResolvedValue([]),getLocalPrinterRoutes:()=>({}),
  isAutoDrawerKickEnabled:()=>true,isRunningInElectron:()=>true,isSilentPrintEnabled:()=>true,
  saveLocalPrinterRoutes:vi.fn(),setAutoDrawerKick:vi.fn(),setSilentPrintEnabled:vi.fn(),
}));
const row=(id='job')=>({id,kind:'kitchen',station_code:'main',status:'pending',attempts:0,last_error:null,created_at:new Date().toISOString(),ticket_text:'طلب: ORDER-'+id+'\nطاولة: 43'});
const flush=async()=>{await act(async()=>{for(let i=0;i<10;i++)await Promise.resolve();});};
beforeEach(()=>{vi.useFakeTimers();vi.clearAllMocks();m.user={id:'operator',branch_id:'A'};m.read.mockResolvedValue([row()]);});
afterEach(()=>{cleanup();vi.useRealTimers();Reflect.deleteProperty(document,'hidden');});
describe('display-only printer monitor reads',()=>{
  it('keeps ticket labels and the visible five-second status cadence, pausing hidden reads',async()=>{
    const screen=render(<PrinterSettingsPanel branchId="A"/>);await flush();
    expect(screen.getByText('ORDER-job')).toBeInTheDocument();expect(screen.getByText('43')).toBeInTheDocument();
    expect(m.read).toHaveBeenCalledOnce();
    await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});expect(m.read).toHaveBeenCalledTimes(2);
    Object.defineProperty(document,'hidden',{configurable:true,value:true});
    await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});expect(m.read).toHaveBeenCalledTimes(2);
    Object.defineProperty(document,'hidden',{configurable:true,value:false});
    await act(async()=>{document.dispatchEvent(new Event('visibilitychange'));});await flush();
    expect(m.read).toHaveBeenCalledTimes(3);
  });
  it('coalesces repeated manual/timer reads while a request is pending',async()=>{
    let finish!:(rows:unknown)=>void;
    m.read.mockReturnValueOnce(new Promise(done=>{finish=done;}));
    const screen=render(<PrinterSettingsPanel branchId="A"/>);await flush();
    await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});
    fireEvent.click(screen.getByRole('button',{name:/^Refresh$/}));
    expect(m.read).toHaveBeenCalledOnce();
    await act(async()=>{finish([row()]);});await flush();expect(m.read).toHaveBeenCalledTimes(2);
  });
  it('preserves last known rows and shows a read error rather than a fake empty queue',async()=>{
    const screen=render(<PrinterSettingsPanel branchId="A"/>);await flush();
    m.read.mockRejectedValueOnce(new Error('READ_TIMEOUT'));
    await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});
    expect(screen.getByText('ORDER-job')).toBeInTheDocument();expect(screen.getByText(/READ_TIMEOUT/)).toBeInTheDocument();
  });
  it('discards the prior branch response after the user changes the selected monitor branch',async()=>{
    let finish!:(rows:unknown)=>void;
    m.read.mockReturnValueOnce(new Promise(done=>{finish=done;}));
    const screen=render(<PrinterSettingsPanel branchId="A"/>);await flush();
    m.read.mockResolvedValue([row('B')]);
    fireEvent.change(screen.getByRole('option',{name:'B'}).parentElement!,{target:{value:'B'}});await flush();
    expect(screen.getByText('ORDER-B')).toBeInTheDocument();
    await act(async()=>{finish([row('A')]);});await flush();
    expect(screen.queryByText('ORDER-A')).not.toBeInTheDocument();expect(m.read).toHaveBeenLastCalledWith('B',150);
  });
  it('invalidates pending reads on an account switch within the same branch',async()=>{
    let finish!:(rows:unknown)=>void;
    m.read.mockReturnValueOnce(new Promise(done=>{finish=done;}));
    const screen=render(<PrinterSettingsPanel branchId="A"/>);await flush();
    m.user={id:'next-operator',branch_id:'A'};m.read.mockResolvedValue([row('new-user')]);
    screen.rerender(<PrinterSettingsPanel branchId="A"/>);await flush();
    await act(async()=>{finish([row('old-user')]);});await flush();
    expect(screen.queryByText('ORDER-old-user')).not.toBeInTheDocument();expect(screen.getByText('ORDER-new-user')).toBeInTheDocument();
  });
});
