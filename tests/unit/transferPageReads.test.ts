vi.mock('@/features/costing/services/rawCurrentPriceData',()=>({loadRawCurrentPrices:mocks.prices}));
import { beforeEach,describe,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({reply:vi.fn(),prices:vi.fn()}));
vi.mock('@/api',()=>({supabase:{from:()=>{const q={select:()=>q,eq:()=>q,order:()=>mocks.reply(),maybeSingle:()=>mocks.reply()};return q;}}}));
import {loadTransferMeta,loadTransferAverageCost,loadTransferDestinationPrices} from '@/features/inventory/services/transferPageData';
beforeEach(()=>vi.resetAllMocks());
describe('transfer read failures remain distinguishable from valid zero',()=>{
 it('rejects incomplete metadata instead of manufacturing empty choices',async()=>{mocks.reply.mockResolvedValue({data:[],error:{code:'57014'}});await expect(loadTransferMeta()).rejects.toThrow('TRANSFER_META_UNAVAILABLE');});
 it('rejects a failed cost read',async()=>{mocks.reply.mockResolvedValue({data:null,error:{code:'57014'}});await expect(loadTransferAverageCost({rawMaterialId:'r',branchId:'b',warehouseId:'w'})).rejects.toThrow('TRANSFER_COST_UNAVAILABLE');});
 it('keeps actual missing inventory as zero without another query',async()=>{mocks.reply.mockResolvedValue({data:null,error:null});expect(await loadTransferAverageCost({rawMaterialId:'r',branchId:'b',warehouseId:'w'})).toBe(0);expect(mocks.reply).toHaveBeenCalledTimes(1);});
});

describe('destination transfer price source',()=>{
 it('batches exact destination IDs and retains an explicit unpriced zero',async()=>{
  mocks.prices.mockResolvedValue([{raw_material_id:'r',branch_id:'b',unit_cost:null},{raw_material_id:'s',branch_id:'b',unit_cost:'1.234567'}]);
  expect(await loadTransferDestinationPrices('b',['r','s','r'])).toEqual({r:0,s:1.234567});
  expect(mocks.prices).toHaveBeenCalledWith('b',['r','s']);expect(mocks.prices).toHaveBeenCalledTimes(1);
 });
 it('rejects absent or foreign-branch rows instead of inventing zero',async()=>{
  mocks.prices.mockResolvedValue([{raw_material_id:'r',branch_id:'foreign',unit_cost:8}]);
  await expect(loadTransferDestinationPrices('b',['r'])).rejects.toThrow('TRANSFER_COST_UNAVAILABLE');
 });
 it('propagates a failed canonical read',async()=>{
  mocks.prices.mockRejectedValue(new Error('timeout'));await expect(loadTransferDestinationPrices('b',['r'])).rejects.toThrow('timeout');
 });
});
