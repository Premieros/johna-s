import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({meta:vi.fn(),cost:vi.fn(),create:vi.fn(),toast:vi.fn(),audit:vi.fn(),refresh:vi.fn()}));
vi.mock('@/api',()=>({inventory:{createTransfer:m.create}}));
vi.mock('@/features/inventory/services/transferPageData',()=>({loadTransferMeta:m.meta,loadTransferAverageCost:m.cost}));
vi.mock('@/context/AuthContext',()=>({useAuth:()=>({user:{id:'actor'}})}));
vi.mock('@/context/LanguageContext',()=>({useLanguage:()=>({lang:'en',t:(k:string)=>k})}));
vi.mock('@/lib/useBranchFilter',()=>({useBranchFilter:()=> 'A'}));
vi.mock('@/lib/useHistoryAccess',()=>({useHistoryAccess:()=>({minIso:null})}));
vi.mock('@/lib/permissions',()=>({useCan:()=>()=>true}));
vi.mock('@/components/Toast',()=>({useToast:()=>({show:m.toast})}));
vi.mock('@/lib/audit',()=>({logAudit:m.audit}));
vi.mock('@/hooks/usePaginatedRows',()=>({usePaginatedRows:()=>({rows:[],loading:false,error:null,hasMore:false,refresh:m.refresh})}));
vi.mock('@/core/guard',()=>({useOperationalGuard:()=>({guardTransfer:()=>true,interceptDbError:()=>false}),PrerequisiteAlertBanner:()=>null,PREREQUISITE_STEPS:{}}));
import {TransfersPage} from '@/features/inventory/pages/TransfersPage';
const raw=(id:string,branch_id:string,name:string)=>({id,branch_id,name,unit_id:'kg',default_cost:1});
beforeEach(()=>{vi.resetAllMocks();m.meta.mockResolvedValue({branches:[{id:'A',name:'A'},{id:'B',name:'B'}],warehouses:[{id:'wa',branch_id:'A',name:'A'},{id:'wb',branch_id:'B',name:'B'}],rawMaterials:[raw('a','A','Sugar'),raw('b','A','Milk'),raw('aa','B','Sugar'),raw('bb','B','Milk')]});m.cost.mockResolvedValue(4);m.create.mockResolvedValue({data:{success:true,transfer_id:'tr'},error:null});});
async function open(){render(<MemoryRouter><TransfersPage/></MemoryRouter>);await waitFor(()=>expect(screen.getByText('newTransfer',{selector:'button'})).toBeEnabled());fireEvent.click(screen.getByText('newTransfer',{selector:'button'}));return within(screen.getByRole('dialog'));}
describe('raw transfer form safety',()=>{
 it('uses one raw selector and ignores a late cost without reverting selection or quantity',async()=>{
  let finish!:(v:number)=>void;m.cost.mockImplementationOnce(()=>new Promise<number>(r=>{finish=r})).mockResolvedValueOnce(8);
  const d=await open();expect(d.getAllByLabelText(/rawMaterial/)).toHaveLength(1);
  fireEvent.change(d.getByLabelText('rawMaterial 1'),{target:{value:'a'}});
  fireEvent.change(d.getByLabelText('rawMaterial 1'),{target:{value:'b'}});
  fireEvent.change(d.getByLabelText('quantity 1'),{target:{value:'7'}});
  await waitFor(()=>expect(d.getByLabelText('unitCost 1')).toHaveValue(8));
  await act(async()=>finish(2));expect(d.getByLabelText('rawMaterial 1')).toHaveValue('b');expect(d.getByLabelText('quantity 1')).toHaveValue(7);expect(d.getByLabelText('unitCost 1')).toHaveValue(8);
 });
 it('sends one financial-independent creation while saving and keeps the resolved destination',async()=>{
  let finish!:(v:unknown)=>void;m.create.mockImplementation(()=>new Promise(r=>{finish=r}));const d=await open();
  fireEvent.change(d.getByLabelText('rawMaterial 1'),{target:{value:'a'}});await waitFor(()=>expect(d.getByText('save',{selector:'button'})).toBeEnabled());
  const button=d.getByText('save',{selector:'button'});fireEvent.click(button);fireEvent.click(button);expect(m.create).toHaveBeenCalledTimes(1);
  expect(m.create).toHaveBeenCalledWith(expect.objectContaining({p_items:[expect.objectContaining({item_id:'a',destination_item_id:'aa'})]}));
  await act(async()=>finish({data:{success:true,transfer_id:'tr'},error:null}));
 });
 it('blocks submission when the cost read failed',async()=>{m.cost.mockRejectedValue(new Error('offline'));const d=await open();fireEvent.change(d.getByLabelText('rawMaterial 1'),{target:{value:'a'}});await waitFor(()=>expect(d.getByRole('alert')).toBeInTheDocument());expect(d.getByText('save',{selector:'button'})).toBeDisabled();expect(m.create).not.toHaveBeenCalled();});
 it('keeps a failed line blocked when another line is removed',async()=>{
  m.cost.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(4);const d=await open();
  fireEvent.change(d.getByLabelText('rawMaterial 1'),{target:{value:'a'}});await waitFor(()=>expect(d.getByRole('alert')).toBeInTheDocument());
  fireEvent.click(d.getByText('add',{selector:'button'}));fireEvent.change(d.getByLabelText('rawMaterial 2'),{target:{value:'b'}});
  await waitFor(()=>expect(d.getByLabelText('unitCost 2')).toHaveValue(4));
  fireEvent.click(d.getAllByTitle('delete')[1]);expect(d.getByText('save',{selector:'button'})).toBeDisabled();expect(d.getByRole('alert')).toBeInTheDocument();
 });
 it('does not repeat a creation after an unconfirmed transport outcome',async()=>{m.create.mockRejectedValue(new TypeError('Failed to fetch'));const d=await open();fireEvent.change(d.getByLabelText('rawMaterial 1'),{target:{value:'a'}});await waitFor(()=>expect(d.getByText('save',{selector:'button'})).toBeEnabled());fireEvent.click(d.getByText('save',{selector:'button'}));await waitFor(()=>expect(d.getByRole('alert')).toHaveTextContent('outcome could not be confirmed'));expect(d.getByText('save',{selector:'button'})).toBeDisabled();expect(m.create).toHaveBeenCalledTimes(1);});
});
