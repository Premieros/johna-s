import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadRawStockSummary, stockSummaryPrices } from '@/features/inventory/services/rawStockSummaryData';
import { loadRawMaterialWarehouseSnapshot } from '@/features/inventory/services/stockCountData';
import type { RawStockSummaryRow } from '@/lib/types';

const mocks = vi.hoisted(() => ({ summary: vi.fn(), from: vi.fn(), range: vi.fn(), eq: vi.fn() }));
vi.mock('@/api', () => ({ inventory: { getRawMaterialStockSummary: mocks.summary }, supabase: { from: mocks.from } }));
beforeEach(() => { vi.clearAllMocks(); });

describe('bounded canonical raw reads', () => {
  it('requests sequential material pages, retaining zero and precise signed quantities', async () => {
    const page = Array.from({length:500}, (_,i) => ({id:String(i),raw_material_id:String(i)}));
    const zero = {id:'zero',raw_material_id:'zero',branch_id:'a',quantity:-0.035,avg_cost:0,price_source:'catalog_zero',priced_at:null,reference_number:null};
    mocks.summary.mockResolvedValueOnce({data:page,error:null}).mockResolvedValueOnce({data:[zero],error:null});
    const rows = await loadRawStockSummary('a');
    expect(rows).toHaveLength(501);
    expect(mocks.summary.mock.calls.map(call => call[0])).toEqual([
      {p_branch_id:'a',p_offset:0,p_limit:500},{p_branch_id:'a',p_offset:500,p_limit:500},
    ]);
    expect(stockSummaryPrices([zero as RawStockSummaryRow])[0].unit_cost).toBe(0);
  });
  it('fails the whole read on a later page error instead of returning partial stock or invented zero', async () => {
    mocks.summary.mockResolvedValueOnce({data:Array(500).fill({id:'raw'}),error:null}).mockResolvedValueOnce({data:null,error:{code:'57014',message:'timeout'}});
    await expect(loadRawStockSummary('a')).rejects.toMatchObject({code:'57014'});
  });
  it('reads every aggregate warehouse page rather than an unpaged history of lots', async () => {
    const query = {select:vi.fn(),eq:mocks.eq,order:vi.fn(),range:mocks.range};
    query.select.mockReturnValue(query); mocks.eq.mockReturnValue(query); query.order.mockReturnValue(query);
    mocks.from.mockReturnValue(query);
    mocks.range.mockResolvedValueOnce({data:Array.from({length:500},(_,i) => ({raw_material_id:String(i),quantity:i===0?-2:1})),error:null})
      .mockResolvedValueOnce({data:[{raw_material_id:'last',quantity:0.035}],error:null});
    const stock = await loadRawMaterialWarehouseSnapshot('a','wh');
    expect(mocks.from).toHaveBeenCalledWith('raw_material_warehouse_inventory');
    expect(mocks.eq.mock.calls).toEqual([['branch_id','a'],['warehouse_id','wh']]);
    expect(mocks.range.mock.calls).toEqual([[0,499],[500,999]]);
    expect(stock['0']).toBe(-2); expect(stock.last).toBe(0.035); expect(Object.keys(stock)).toHaveLength(501);
  });
});
