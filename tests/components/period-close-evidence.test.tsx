import { fireEvent,render,screen,within,waitFor } from '@testing-library/react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
const calls=vi.hoisted(()=>({raw:vi.fn(),metrics:vi.fn(),cost:vi.fn(),moves:vi.fn(),documents:vi.fn(),append:vi.fn(),write:vi.fn()}));
vi.mock('xlsx',()=>({utils:{book_new:()=>({}),json_to_sheet:(records:unknown[])=>({records,'!ref':'A1:H2'}),book_append_sheet:calls.append},writeFile:calls.write}));
vi.mock('@/lib/permissions',()=>({useCan:()=>()=>true}));
vi.mock('@/api',()=>({reporting:{getPeriodCloseRaw:calls.raw,getOperationalReportMetrics:calls.metrics,getSoldRecipeConsumptionReport:calls.cost,getPeriodCloseRawMovements:calls.moves,getOperationalReportPage:calls.documents}}));
vi.mock('@/context/AuthContext',()=>({useAuth:()=>({user:{id:'reviewer'}})}));
vi.mock('@/context/LanguageContext',()=>({useLanguage:()=>({lang:'en'})}));
vi.mock('@/lib/useBranchFilter',()=>({useBranchFilter:()=> 'A'}));
vi.mock('@/hooks/useReportPermissionVersion',()=>({useReportPermissionVersion:()=>1}));
import { PeriodCloseReport } from '@/features/reporting/PeriodCloseReport';
const raw={valued_at:'2026-11-05T10:00:00Z',opening_complete:true,closing_complete:true,opening:100,closing:80,purchase:40,transfer:0,unpriced:0,materials:[{id:'raw',name:'Water',code:'W',price:10,source:'pricing',opening:10,closing:8,purchase:4,transfer:0,adjustment:1,other:-7}]};
beforeEach(()=>{
 vi.clearAllMocks();calls.raw.mockResolvedValue({data:raw});calls.metrics.mockImplementation(async(p:{p_report_type:string})=>({data:p.p_report_type==='sales'?{'Net Sales':200}:p.p_report_type==='purchases'?{'Net Purchases':30}:{Amount:5}}));
 calls.cost.mockResolvedValue({data:{rows:[{raw_material_id:'raw',raw_material_name:'Water',unit_name:'bottle',consumed_quantity:3,returned_quantity:1,net_quantity:2,unit_price:10,consumption_value:20}],summary:{count:1,total:20,complete:true}}});
 calls.moves.mockResolvedValue({data:{rows:[],count:0,total:40}});calls.documents.mockResolvedValue({data:{rows:[],summary:{count:0,total:200}}});
});
async function run(){render(<PeriodCloseReport/>);fireEvent.change(screen.getByLabelText('From'),{target:{value:'2026-10-01'}});fireEvent.change(screen.getByLabelText('To'),{target:{value:'2026-10-31'}});fireEvent.click(screen.getByRole('button',{name:'Run report'}));await screen.findByText('Opening raw stock balance');}
describe('period close drill-down',()=>{
 it('loads no evidence before a click and shows numeric historical balances without boundary counts',async()=>{
  await run();expect(calls.moves).not.toHaveBeenCalled();expect(calls.documents).not.toHaveBeenCalled();expect(calls.cost).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Opening raw stock balance').closest('tr')).toHaveTextContent('100.00');
  expect(screen.getAllByRole('button',{name:/^View details:/})).toHaveLength(11);
  fireEvent.click(screen.getByRole('button',{name:'View details: Net raw purchases at latest prices'}));
  await screen.findByText('Period total — all pages');expect(calls.moves).toHaveBeenCalledWith(expect.objectContaining({p_branch_id:'A',p_from:'2026-10-01',p_to:'2026-10-31',p_kind:'purchase',p_page:0,p_page_size:50}),expect.any(AbortSignal));
 });
 it('uses the same recipe source for consumption and shows components rather than another profit source',async()=>{
  await run();fireEvent.click(screen.getByRole('button',{name:'View details: Estimated profit or loss'}));
  expect(calls.cost).toHaveBeenCalledTimes(1);expect(screen.getByText('Net sales − sales consumption − expenses')).toBeTruthy();
  const row=screen.getByText('Net sales consumption cost').parentElement!;fireEvent.click(within(row).getByRole('button',{name:'View details'}));
  await screen.findByText('Water');expect(calls.cost).toHaveBeenLastCalledWith(expect.objectContaining({p_branch_id:'A',p_from_date:'2026-10-01',p_to_date:'2026-10-31',p_group_by:'material',p_page:0,p_page_size:50}),expect.any(AbortSignal));
 });
 it('opens per-material movement evidence and hides stale results when dates change',async()=>{
  await run();fireEvent.click(screen.getByRole('button',{name:'View details: Opening raw stock balance'}));fireEvent.click(screen.getByRole('button',{name:'Material movements'}));
  await screen.findByText('No movements for this period.');expect(calls.moves).toHaveBeenLastCalledWith(expect.objectContaining({p_material_id:'raw',p_kind:'all'}),expect.any(AbortSignal));
  fireEvent.change(screen.getByLabelText('To'),{target:{value:'2026-10-30'}});expect(screen.queryByText('Period total — all pages')).toBeNull();
 });
 it('supports a single day and passes identical Cairo boundaries to invoices',async()=>{
  render(<PeriodCloseReport/>);for(const label of ['From','To']) fireEvent.change(screen.getByLabelText(label),{target:{value:'2026-10-01'}});fireEvent.click(screen.getByRole('button',{name:'Run report'}));
  await screen.findByText('Opening raw stock balance');fireEvent.click(screen.getByRole('button',{name:'View details: Net sales'}));await screen.findByText('Period total — all pages');
  expect(calls.documents).toHaveBeenLastCalledWith(expect.objectContaining({p_branch_id:'A',p_from_date:'2026-10-01',p_to_date:'2026-10-01',p_from_ts:'2026-09-30T21:00:00.000Z',p_to_exclusive_ts:'2026-10-01T21:00:00.000Z'}),expect.any(AbortSignal));
 });
 it('exports all evidence pages into the full Excel workbook only on request',async()=>{
  await run();const movement={id:1,raw_material_id:'raw',name:'Water',code:'W',created_at:'2026-10-01T10:00:00Z',entry_type:'purchase',reference_type:'purchase',reference_number:'P1',warehouse_name:'Main',quantity:1,price:10,value:10};
  calls.moves.mockImplementation(async(p:{p_page:number})=>({data:{rows:Array.from({length:p.p_page?1:200},(_,i)=>({...movement,id:p.p_page*200+i})),count:201,total:2010}}));
  fireEvent.click(screen.getByRole('button',{name:'Export full report to Excel'}));await waitFor(()=>expect(calls.write).toHaveBeenCalled());
  expect(calls.moves).not.toHaveBeenCalled();expect(calls.append).toHaveBeenCalledTimes(6);

  expect(calls.write.mock.calls[0][1]).toBe('period-close-2026-10-01-2026-10-31.xlsx');
 });

 it('exports every movement page only for the opened evidence report',async()=>{
  await run();fireEvent.click(screen.getByRole('button',{name:'View details: Net raw purchases at latest prices'}));await screen.findByText('Period total — all pages');calls.moves.mockClear();
  const movement={id:1,raw_material_id:'raw',name:'Water',code:'W',created_at:'2026-10-01T10:00:00Z',entry_type:'purchase',reference_type:'purchase',reference_number:'P1',warehouse_name:'Main',quantity:1,price:10,value:10};
  calls.moves.mockImplementation(async(p:{p_page:number})=>({data:{rows:Array.from({length:p.p_page?1:200},(_,i)=>({...movement,id:p.p_page*200+i})),count:201,total:2010}}));
  fireEvent.click(screen.getByRole('button',{name:'Export all detail pages to Excel'}));await waitFor(()=>expect(calls.write).toHaveBeenCalled());
  expect(calls.moves).toHaveBeenCalledTimes(2);expect(calls.append.mock.calls[0][1].records).toHaveLength(201);
 });

});
