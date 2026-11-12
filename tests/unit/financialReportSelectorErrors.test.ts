import {beforeEach,describe,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({result:vi.fn()}));
vi.mock('@/api',()=>({supabase:{from:()=>({select(){return this;},eq(){return this;},order:mock.result})}}));
import {loadInventoryStatementOptions,loadLedgerAccounts,loadPartyStatementOptions,loadTreasuryAccounts} from '@/features/accounting/services/financialReportSelectors';
beforeEach(()=>mock.result.mockReset());
describe('financial report option errors',()=>{
 it.each([
  ()=>loadLedgerAccounts('A'),
  ()=>loadTreasuryAccounts('A'),
  ()=>loadPartyStatementOptions('A','ar'),
  ()=>loadPartyStatementOptions('A','ap'),
 ])('does not turn an inaccessible source into an empty list',async load=>{
  const error={message:'permission denied'};mock.result.mockResolvedValue({data:null,error});
  await expect(load()).rejects.toBe(error);
 });
 it.each([0,1])('rejects incomplete item/warehouse option pairs (%s)',async failed=>{
  const error={message:'read failed'};
  mock.result.mockResolvedValueOnce(failed===0?{data:null,error}:{data:[],error:null}).mockResolvedValueOnce(failed===1?{data:null,error}:{data:[],error:null});
  await expect(loadInventoryStatementOptions('A','raw_material')).rejects.toBe(error);
 });
 it('preserves a successfully read empty list',async()=>{
  mock.result.mockResolvedValue({data:[],error:null});await expect(loadLedgerAccounts('A')).resolves.toEqual([]);
 });
});
