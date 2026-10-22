import { beforeEach,describe,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({reply:vi.fn()}));
vi.mock('@/api',()=>({supabase:{from:()=>{const q={select:()=>q,eq:()=>q,order:()=>mocks.reply(),maybeSingle:()=>mocks.reply()};return q;}}}));
import {loadTransferMeta,loadTransferAverageCost} from '@/features/inventory/services/transferPageData';
beforeEach(()=>vi.resetAllMocks());
describe('transfer read failures remain distinguishable from valid zero',()=>{
 it('rejects incomplete metadata instead of manufacturing empty choices',async()=>{mocks.reply.mockResolvedValue({data:[],error:{code:'57014'}});await expect(loadTransferMeta()).rejects.toThrow('TRANSFER_META_UNAVAILABLE');});
 it('rejects a failed cost read',async()=>{mocks.reply.mockResolvedValue({data:null,error:{code:'57014'}});await expect(loadTransferAverageCost({rawMaterialId:'r',branchId:'b',warehouseId:'w'})).rejects.toThrow('TRANSFER_COST_UNAVAILABLE');});
 it('keeps actual missing inventory as zero without another query',async()=>{mocks.reply.mockResolvedValue({data:null,error:null});expect(await loadTransferAverageCost({rawMaterialId:'r',branchId:'b',warehouseId:'w'})).toBe(0);expect(mocks.reply).toHaveBeenCalledTimes(1);});
});
