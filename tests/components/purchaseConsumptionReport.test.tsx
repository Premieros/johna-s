import { fireEvent,render,screen,waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach,describe,expect,it,vi } from 'vitest';
const state=vi.hoisted(()=>({branch:'branch-a',permissions:new Set(['reports.view','reports.costing','reports.export']),load:vi.fn(),excel:vi.fn()}));
vi.mock('@/api',()=>({reporting:{getConsumptionPurchaseReport:state.load}}));
vi.mock('@/context/SettingsContext',()=>({useSettings:()=>({effectiveSettings:()=>({currency:'EGP'})})}));
vi.mock('@/context/AuthContext',()=>({useAuth:()=>({user:{id:'reader',role:'manager'}})}));
vi.mock('@/context/LanguageContext',()=>({useLanguage:()=>({lang:'en'})}));
vi.mock('@/lib/permissions',()=>({useCan:()=>(p:string)=>state.permissions.has(p)}));
vi.mock('@/lib/useBranchFilter',()=>({useBranchFilter:()=>state.branch}));
vi.mock('@/hooks/useReportPermissionVersion',()=>({useReportPermissionVersion:()=>1}));
vi.mock('@/lib/excel',()=>({exportToExcelAdvanced:state.excel}));
import { ConsumptionReportPage } from '@/features/reporting/pages/ConsumptionReportPage';
const row={branch_id:'branch-a',branch_name:'A',raw_material_id:'raw',raw_material_name:'Flour',raw_material_code:'F',product_id:null,product_name:null,unit_name:'kg',consumed_quantity:6,returned_quantity:1.5,waste_quantity:0,net_quantity:4.5,last_purchase_price:10,price_date:null,purchase_reference:'P1',consumption_value:45,price_missing:false};
const data={rows:[row],summary:{count:1,total:45,unpriced_count:0,unattributed_count:0,complete:true},pricing_basis:'latest_completed_purchase',from:'2026-10-01',to:'2026-10-31',generated_at:'2026-10-20'};
const open=()=>render(<MemoryRouter initialEntries={['/reports?from=2026-10-01&to=2026-10-31']}><ConsumptionReportPage /></MemoryRouter>);
beforeEach(()=>{state.branch='branch-a';state.permissions=new Set(['reports.view','reports.costing','reports.export']);state.load.mockReset().mockResolvedValue({data,error:null});state.excel.mockReset();localStorage.clear();});
describe('purchase-priced consumption workspace',()=>{
 it('does no report query until requested, sends selected dates, and displays net quantities',async()=>{
  open();expect(state.load).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Run report'}));
  await screen.findByText('Flour');expect(state.load.mock.calls[0][0]).toMatchObject({p_branch_id:'branch-a',p_from_date:'2026-10-01',p_to_date:'2026-10-31',p_group_by:'material',p_page:0});
  expect(screen.getByText('4.5')).toBeTruthy();expect(screen.getByText(/Total consumption value/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('From'),{target:{value:'2026-09-01'}});expect(state.load).toHaveBeenCalledTimes(1);expect(screen.getByText(/Filters changed/)).toBeTruthy();
 });
 it('never displays missing purchase cost as zero or a complete total',async()=>{
  state.load.mockResolvedValue({data:{...data,rows:[{...row,last_purchase_price:null,consumption_value:null,price_missing:true}],summary:{...data.summary,total:0,complete:false,unpriced_count:1}},error:null});
  open();fireEvent.click(screen.getByRole('button',{name:'Run report'}));await screen.findByText(/Incomplete value/);
  expect(screen.getAllByText('No purchase price')).toHaveLength(2);expect(screen.getByText(/Priced subtotal only/)).toBeTruthy();
 });
 it('aborts and discards a slow old-branch response',async()=>{
  let resolve!:(value:unknown)=>void;state.load.mockImplementation(()=>new Promise(value=>{resolve=value;}));
  const view=open();fireEvent.click(screen.getByRole('button',{name:'Run report'}));const signal=state.load.mock.calls[0][1] as AbortSignal;
  state.branch='branch-b';view.rerender(<MemoryRouter><ConsumptionReportPage /></MemoryRouter>);expect(signal.aborted).toBe(true);
  resolve({data,error:null});await waitFor(()=>expect(screen.queryByText('Flour')).toBeNull());
 });
 it('exports the full server result, not only the visible page, and refuses a changed total',async()=>{
  const summary={...data.summary,count:101,total:4545};
  state.load.mockResolvedValueOnce({data:{...data,summary},error:null}).mockResolvedValueOnce({data:{...data,rows:Array.from({length:101},(_,i)=>({...row,raw_material_id:String(i)})),summary},error:null});
  open();fireEvent.click(screen.getByRole('button',{name:'Run report'}));await screen.findByText('Flour');fireEvent.click(screen.getByRole('button',{name:'Excel'}));
  await waitFor(()=>expect(state.excel).toHaveBeenCalledTimes(1));expect(state.excel.mock.calls[0][0].data).toHaveLength(101);
  state.load.mockResolvedValue({data:{...data,summary:{...summary,total:1}},error:null});fireEvent.click(screen.getByRole('button',{name:'Excel'}));
  await screen.findByRole('alert');expect(state.excel).toHaveBeenCalledTimes(1);
 });
 it('denies the report without costing permission',()=>{
  state.permissions.delete('reports.costing');open();expect(screen.getByRole('alert').textContent).toContain('permission');expect(state.load).not.toHaveBeenCalled();
 });
});
