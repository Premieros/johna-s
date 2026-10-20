import { fireEvent,render,screen,waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach,describe,expect,it,vi } from 'vitest';
const state=vi.hoisted(()=>({branch:'branch-a',permissions:new Set(['reports.view','reports.costing','reports.export']),load:vi.fn(),excel:vi.fn()}));
vi.mock('@/api',()=>({reporting:{getConsumptionLatestReport:state.load}}));
vi.mock('@/context/SettingsContext',()=>({useSettings:()=>({effectiveSettings:()=>({currency:'EGP'})})}));
vi.mock('@/context/AuthContext',()=>({useAuth:()=>({user:{id:'reader',role:'manager'}})}));
vi.mock('@/context/LanguageContext',()=>({useLanguage:()=>({lang:'en'})}));
vi.mock('@/lib/permissions',()=>({useCan:()=>(p:string)=>state.permissions.has(p)}));
vi.mock('@/lib/useBranchFilter',()=>({useBranchFilter:()=>state.branch}));
vi.mock('@/hooks/useReportPermissionVersion',()=>({useReportPermissionVersion:()=>1}));
vi.mock('@/lib/excel',()=>({exportToExcelAdvanced:state.excel}));
import { ConsumptionReportPage } from '@/features/reporting/pages/ConsumptionReportPage';
const row={branch_id:'branch-a',branch_name:'A',raw_material_id:'raw',raw_material_name:'Flour',raw_material_code:'F',product_id:null,product_name:null,unit_name:'kg',consumed_quantity:6,returned_quantity:1.5,waste_quantity:0,net_quantity:4.5,unit_price:10,price_source:'pricing',price_date:null,price_reference:'P1',consumption_value:45,price_missing:false};
const data={rows:[row],summary:{count:1,total:45,unpriced_count:0,unattributed_count:0,complete:true},pricing_basis:'latest_approved',from:'2026-10-01',to:'2026-10-31',generated_at:'2026-10-20'};
const open=()=>render(<MemoryRouter initialEntries={['/reports?from=2026-10-01&to=2026-10-31']}><ConsumptionReportPage /></MemoryRouter>);
beforeEach(()=>{state.branch='branch-a';state.permissions=new Set(['reports.view','reports.costing','reports.export']);state.load.mockReset().mockResolvedValue({data,error:null});state.excel.mockReset();localStorage.clear();});
describe('latest-approved-price consumption workspace',()=>{
 it('does no report query until requested, sends selected dates, and displays net quantities',async()=>{
  open();expect(state.load).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Run report'}));
  await screen.findByText('Flour');expect(state.load.mock.calls[0][0]).toMatchObject({p_branch_id:'branch-a',p_from_date:'2026-10-01',p_to_date:'2026-10-31',p_group_by:'material',p_page:0});
  expect(screen.getByText('4.5')).toBeTruthy();expect(screen.getByText(/Total consumption value/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('From'),{target:{value:'2026-09-01'}});expect(state.load).toHaveBeenCalledTimes(1);expect(screen.getByText(/Filters changed/)).toBeTruthy();
 });
 it('displays missing prices and values as numeric zeros and exports summable cells',async()=>{
  state.load.mockResolvedValue({data:{...data,rows:[{...row,unit_price:0,price_source:'unpriced',consumption_value:0,price_missing:true}],summary:{...data.summary,total:0,complete:false,unpriced_count:1}},error:null});
  open();fireEvent.click(screen.getByRole('button',{name:'Run report'}));await screen.findByText(/Rows counted with zero price/);
  expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(2);expect(screen.getByText(/Total consumption value/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Excel'}));await waitFor(()=>expect(state.excel).toHaveBeenCalledTimes(1));
  expect(state.excel.mock.calls[0][0].data[0]).toMatchObject({'Latest approved / unit':0,'Consumption value':0,'Price source':'No price — counted as zero'});
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
  expect(screen.getByTestId('consumption-grand-total').textContent).toContain('4,545');
  expect(screen.getByText('Flour').getAttribute('data-primary')).toBe('true');
  expect(state.excel.mock.calls[0][0]).toMatchObject({title:'Consumption at latest approved price',totalRow:{'Total consumption value':4545,'Rows counted with zero price':0}});
  state.load.mockResolvedValue({data:{...data,summary:{...summary,total:1}},error:null});fireEvent.click(screen.getByRole('button',{name:'Excel'}));
  await screen.findByRole('alert');expect(state.excel).toHaveBeenCalledTimes(1);
 });
 it('exports 1001 rows in one bounded read, rejects oversized results before requesting them',async()=>{
  const summary={...data.summary,count:1001,total:45045};
  state.load.mockResolvedValueOnce({data:{...data,summary},error:null}).mockResolvedValueOnce({data:{...data,rows:Array.from({length:1001},(_,i)=>({...row,raw_material_id:String(i)})),summary},error:null});
  open();fireEvent.click(screen.getByRole('button',{name:'Run report'}));await screen.findByText('Flour');
  fireEvent.click(screen.getByRole('button',{name:'Excel'}));await waitFor(()=>expect(state.excel).toHaveBeenCalledOnce());
  expect(state.load).toHaveBeenCalledTimes(2);expect(state.load.mock.calls[1][0]).toMatchObject({p_page:0,p_page_size:1001});
  expect(state.excel.mock.calls[0][0].data).toHaveLength(1001);
  state.load.mockResolvedValueOnce({data:{...data,summary:{...summary,count:5001}},error:null});
  fireEvent.click(screen.getByRole('button',{name:'Run report'}));await waitFor(()=>expect(screen.getByTestId('consumption-grand-total').textContent).toContain('5001'));
  fireEvent.click(screen.getByRole('button',{name:'Excel'}));await screen.findByRole('alert');expect(state.load).toHaveBeenCalledTimes(3);expect(state.excel).toHaveBeenCalledOnce();
 });
 it('denies the report without costing permission',()=>{
  state.permissions.delete('reports.costing');open();expect(screen.getByRole('alert').textContent).toContain('permission');expect(state.load).not.toHaveBeenCalled();
 });
});
