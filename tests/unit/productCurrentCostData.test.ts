import { describe,expect,it,vi } from 'vitest';
import { loadProductCurrentCosts } from '@/features/costing/services/productCurrentCostData';
const mocks=vi.hoisted(()=>({getOverview:vi.fn()}));
vi.mock('@/api',()=>({costing:{getOverview:mocks.getOverview}}));
describe('shared authoritative product unit costs',()=>{
  it('keeps incomplete cost distinct from numeric zero and ignores a conflicting manual/FIFO field',async()=>{
    mocks.getOverview.mockResolvedValue({data:[{product_id:'priced',actual_cost:'7.02',unit_cost:99,theoretical_cost:98},{product_id:'missing',actual_cost:null,unit_cost:99}],error:null});
    expect(await loadProductCurrentCosts('a')).toEqual({priced:7.02,missing:null});
    expect(mocks.getOverview).toHaveBeenCalledWith({p_branch_id:'a'});
  });
  it('propagates read errors instead of presenting a fabricated zero',async()=>{
    mocks.getOverview.mockResolvedValue({data:null,error:new Error('denied')});
    await expect(loadProductCurrentCosts('b')).rejects.toThrow('denied');
  });
});
