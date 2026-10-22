import { fireEvent,render,screen } from '@testing-library/react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
const calls=vi.hoisted(()=>({metrics:vi.fn(),cost:vi.fn()}));
vi.mock('@/api',()=>({reporting:{getOperationalReportMetrics:calls.metrics,getSoldRecipeConsumptionReport:calls.cost}}));
vi.mock('@/context/AuthContext',()=>({useAuth:()=>({user:{id:'reviewer',role:'manager'}})}));
vi.mock('@/context/LanguageContext',()=>({useLanguage:()=>({lang:'en'})}));
vi.mock('@/lib/useBranchFilter',()=>({useBranchFilter:()=> 'A'}));
vi.mock('@/lib/useHistoryAccess',()=>({useHistoryAccess:()=>({unlimited:true})}));
vi.mock('@/hooks/useReportPermissionVersion',()=>({useReportPermissionVersion:()=>1}));
import { MonthCloseReview } from '@/features/reporting/MonthCloseReview';
const costView={key:'component_consumption',type:'component_consumption' as const,ar:'استهلاك',en:'Consumption',permissions:['reports.costing']};
beforeEach(()=>{calls.metrics.mockReset().mockImplementation(async(p:{p_report_type:string})=>({data:p.p_report_type==='sales'?{'Net Sales':100,'Net Collection':80}:p.p_report_type==='purchases'?{'Net Purchases':30}:{Amount:5},error:null}));calls.cost.mockReset().mockResolvedValue({data:{rows:[],summary:{total:20,unpriced_count:1}},error:null});});
describe('explicit month review summary',()=>{
 it('loads only aggregate sources on request and identifies materials counted at zero',async()=>{
  render(<MonthCloseReview views={[costView]} onSelect={vi.fn()} />);expect(calls.metrics).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Review month'),{target:{value:'2026-09'}});fireEvent.click(screen.getByRole('button',{name:'Show month summary'}));
  await screen.findByText(/Materials without prices counted as zero/);expect(calls.metrics).toHaveBeenCalledTimes(3);expect(calls.cost).toHaveBeenCalledTimes(1);
  expect(calls.cost.mock.calls[0][0]).toMatchObject({p_branch_id:'A',p_from_date:'2026-09-01',p_to_date:'2026-09-30',p_group_by:'material',p_page_size:1});expect(calls.cost.mock.calls[0][0]).not.toHaveProperty('p_include_waste');
  expect(calls.metrics.mock.calls[0][0]).toMatchObject({p_branch_id:'A',p_from_date:'2026-09-01',p_to_date:'2026-09-30'});expect(screen.getByText('100')).toBeTruthy();
 });
 it('warns about partial recipe costs without any additional reads',async()=>{
  calls.cost.mockResolvedValue({data:{rows:[],summary:{total:20,unpriced_count:0,complete:false,missing_recipe_count:2,invalid_unit_count:1}},error:null});
  render(<MonthCloseReview views={[costView]} onSelect={vi.fn()} />);
  fireEvent.click(screen.getByRole('button',{name:'Show month summary'}));
  const warning=await screen.findByRole('alert');expect(warning.textContent).toContain('Consumption cost is partial');expect(warning.textContent).toContain('Missing recipes: 2');expect(warning.textContent).toContain('Unresolved units: 1');
  expect(calls.cost).toHaveBeenCalledTimes(1);expect(calls.metrics).toHaveBeenCalledTimes(3);
  expect(screen.getByText('Estimated margin after current recipe cost').closest('tr')?.textContent).toContain('Unavailable');
 });
 it('derives the owner margin from the same aggregates only when recipe cost is complete',async()=>{
  calls.cost.mockResolvedValue({data:{rows:[],summary:{total:20,unpriced_count:0,complete:true,missing_recipe_count:0,invalid_unit_count:0}},error:null});
  render(<MonthCloseReview views={[costView]} onSelect={vi.fn()} />);
  fireEvent.click(screen.getByRole('button',{name:'Show month summary'}));
  const label=await screen.findByText('Estimated margin after current recipe cost');expect(label.closest('tr')?.textContent).toContain('80');
  expect(screen.getByText('Estimated result after posted expenses, before other adjustments').closest('tr')?.textContent).toContain('75');
  expect(calls.metrics).toHaveBeenCalledTimes(3);expect(calls.cost).toHaveBeenCalledTimes(1);
 });
 it('keeps failed or null amounts unavailable and never queries costing without its permission',async()=>{
  calls.metrics.mockResolvedValue({data:{Amount:null},error:null});render(<MonthCloseReview views={[]} onSelect={vi.fn()} />);
  fireEvent.click(screen.getByRole('button',{name:'Show month summary'}));await screen.findByText(/Operational summary/);
  expect(screen.getAllByText('Unavailable')).toHaveLength(4);expect(calls.cost).not.toHaveBeenCalled();
 });
});
