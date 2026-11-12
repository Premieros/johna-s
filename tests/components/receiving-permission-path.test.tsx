import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import {ReceivingPage} from '@/features/trade/pages/ReceivingPage';
const m=vi.hoisted(()=>({granted:new Set<string>(),receive:vi.fn()}));
vi.mock('@/lib/permissions',()=>({useCan:()=> (p:string)=>m.granted.has(p)}));
vi.mock('@/lib/useBranchFilter',()=>({useBranchFilter:()=> 'branch'}));
vi.mock('@/context/LanguageContext',()=>({useLanguage:()=>({lang:'en',t:(k:string)=>k})}));
vi.mock('@/context/SettingsContext',()=>({useSettings:()=>({settings:{currency:'EGP'},effectiveSettings:()=>({currency:'EGP'})})}));
vi.mock('@/hooks/useBranches',()=>({useBranches:()=>({branches:[{id:'branch',name:'Branch'}]})}));
vi.mock('@/components/Toast',()=>({useToast:()=>({show:vi.fn()})}));
vi.mock('@/components/DataTable',()=>({DataTable:({columns,data}:{columns:Array<{key:string;render?:(r:unknown)=>unknown}>;data:unknown[]})=><div>{data.map((r,i)=><div key={i}>{columns.find(c=>c.key==='actions')?.render?.(r) as React.ReactNode}</div>)}</div>}));
vi.mock('@/api',()=>({procurement:{getPurchaseBackorders:vi.fn().mockResolvedValue({data:[{purchase_id:'purchase',purchase_item_id:'line',branch_id:'branch',item_name:'Item',ordered_quantity:2,received_quantity:0,remaining:2,unit_cost:10}],error:null}),getPurchaseReceipts:vi.fn().mockResolvedValue({data:[],error:null}),getSupplierEvaluation:vi.fn().mockResolvedValue({data:[],error:null}),receivePurchaseOrder:m.receive}}));
beforeEach(()=>{vi.clearAllMocks();m.granted.clear();m.granted.add('purchases.receiving');m.receive.mockResolvedValue({data:{success:true,fully_received:true},error:null});});afterEach(cleanup);
it('view-only receiving keeps action disabled and cannot open the receipt form',async()=>{
 render(<MemoryRouter><ReceivingPage/></MemoryRouter>);const button=await screen.findByRole('button',{name:'receive'});expect(button).toBeDisabled();fireEvent.click(button);expect(screen.queryByRole('button',{name:'save'})).not.toBeInTheDocument();expect(m.receive).not.toHaveBeenCalled();
});
it('dedicated receiver submits without purchase management and loses access safely mid-form',async()=>{
 m.granted.add('procurement.receive');const view=render(<MemoryRouter><ReceivingPage/></MemoryRouter>);fireEvent.click(await screen.findByRole('button',{name:'receive'}));
 fireEvent.change(screen.getByRole('spinbutton'),{target:{value:'1'}});m.granted.delete('procurement.receive');view.rerender(<MemoryRouter><ReceivingPage/></MemoryRouter>);expect(screen.getByRole('button',{name:'save'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'save'}));expect(m.receive).not.toHaveBeenCalled();
 m.granted.add('procurement.receive');view.rerender(<MemoryRouter><ReceivingPage/></MemoryRouter>);fireEvent.click(screen.getByRole('button',{name:'save'}));await waitFor(()=>expect(m.receive).toHaveBeenCalledExactlyOnceWith({p_purchase_id:'purchase',p_receipt_items:[{purchase_item_id:'line',quantity_received:1}]}));
});
