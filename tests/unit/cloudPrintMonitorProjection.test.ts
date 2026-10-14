import {beforeEach,describe,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({select:vi.fn(),eq:vi.fn(),limit:vi.fn(),result:{data:[] as unknown[],error:null as unknown}}));
vi.mock('@/api',()=>({supabase:{from:()=>{const q={select:(x:string)=>{m.select(x);return q;},eq:(key:string,value:string)=>{m.eq(key,value);return q;},order:()=>q,limit:(n:number)=>{m.limit(n);return Promise.resolve(m.result);}};return q;},auth:{onAuthStateChange:vi.fn()}},pos:{},shifts:{}}));
vi.mock('@/features/pos/services/localPrintAgent',()=>({buildKitchenFixedTemplate:vi.fn(),buildStationTicketText:vi.fn(),groupKitchenItemsByStation:vi.fn()}));
import {listCloudPrintQueueSummary} from '@/features/pos/services/cloudPrint';
beforeEach(()=>{vi.clearAllMocks();m.result={data:[],error:null};});
describe('print monitoring projection',()=>{
  it('selects only status/display fields and ticket text, keeping branch restriction',async()=>{
    await listCloudPrintQueueSummary(' A ',150);
    expect(m.select).toHaveBeenCalledWith('id,kind,station_code,status,attempts,last_error,created_at,updated_at,ticket_text:payload->>text');
    expect(m.eq).toHaveBeenCalledWith('branch_id','A');expect(m.limit).toHaveBeenCalledWith(150);
  });
  it('does not read an empty branch and bounds requested rows',async()=>{
    expect(await listCloudPrintQueueSummary('')).toEqual([]);expect(m.select).not.toHaveBeenCalled();
    await listCloudPrintQueueSummary('B',9999);expect(m.limit).toHaveBeenCalledWith(250);
  });
  it('propagates a read failure to the monitor without modifying jobs',async()=>{
    m.result={data:[],error:new Error('RLS_DENIED')};
    await expect(listCloudPrintQueueSummary('A')).rejects.toThrow('RLS_DENIED');
  });
});
