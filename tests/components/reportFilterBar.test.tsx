import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {ReportFilterBar,type ReportFilterBarProps} from '@/features/reporting/ReportFilterBar';
vi.mock('@/context/LanguageContext',()=>({useLanguage:()=>({lang:'en',t:(key:string)=>key})}));
vi.mock('@/lib/useHistoryAccess',()=>({useHistoryAccess:()=>({clampRange:(from:string,to:string)=>({from,to})})}));
afterEach(cleanup);
const props=():ReportFilterBarProps=>({reportType:'purchases',filters:{},onFilterChange:vi.fn(),showDate:true,period:'custom',onPeriodChange:vi.fn(),from:'2026-10-01',to:'2026-10-31',onFromChange:vi.fn(),onToChange:vi.fn(),showBranchFilter:false,branches:[],branchFilterValue:'',onBranchFilterChange:vi.fn(),filterOptions:()=>[{value:'raw',label:'Flour'}],filterLabel:dim=>dim,allLabel:()=> 'All',filterDimensions:['raw_material'],total:20,count:1,currency:'EGP',lang:'en'});
describe('visible useful report controls',()=>{
 it('keeps date boundaries visible and makes material filters available in the collapsed filter group',()=>{
  const p=props();render(<ReportFilterBar {...p}/>);
  expect(screen.getByLabelText('from')).toBeVisible();expect(screen.getByLabelText('to')).toBeVisible();
  fireEvent.change(screen.getByLabelText('from'),{target:{value:'2026-09-01'}});expect(p.onFromChange).toHaveBeenCalledWith('2026-09-01');
  fireEvent.click(screen.getByText(/More filters/));
  fireEvent.change(screen.getByLabelText('raw_material'),{target:{value:'raw'}});expect(p.onFilterChange).toHaveBeenCalledWith('raw_material','raw');
 });
 it('uses one as-of date for historical balances and explains current data without fake period controls',()=>{
  const p=props();const view=render(<ReportFilterBar {...p} asOfDate/>);
  expect(screen.queryByLabelText('from')).toBeNull();expect(screen.getByLabelText('Through end of day')).toBeVisible();
  view.rerender(<ReportFilterBar {...p} showDate={false}/>);expect(screen.queryByLabelText('to')).toBeNull();expect(screen.getByText(/Current data/)).toBeVisible();
 });
 it('clears filters explicitly and shows when lookup options are loading',()=>{
  const clear=vi.fn();render(<ReportFilterBar {...props()} onClearFilters={clear} optionsLoading/>);
  fireEvent.click(screen.getByText(/More filters/));expect(screen.getByLabelText('raw_material')).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'Clear filters'}));expect(clear).toHaveBeenCalledOnce();
 });
});
