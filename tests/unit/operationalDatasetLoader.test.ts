import { beforeEach,describe,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({dataset:vi.fn()}));
vi.mock('@/api',()=>({reporting:{getOperationalReportDataset:mocks.dataset}}));
import { loadSalesReportRows } from '@/features/reporting/services/reportCoreLoaders';
const args={branchId:'a',from:'2026-10-01',to:'2026-10-07',fromTs:'2026-09-30T21:00:00Z',toExclusiveTs:'2026-10-07T21:00:00Z',filters:{payment_method:'cash'}};
beforeEach(()=>vi.clearAllMocks());
describe('canonical operational dataset',()=>{
 it('uses one RPC for full reads with the same dates, scope and filters',async()=>{
  mocks.dataset.mockResolvedValue({data:{rows:[{id:'one'}],summary:{count:1,total:10}},error:null});
  expect(await loadSalesReportRows(args)).toEqual([{id:'one'}]);
  expect(mocks.dataset).toHaveBeenCalledTimes(1);
  expect(mocks.dataset.mock.calls[0][0]).toMatchObject({p_report_type:'sales',p_branch_id:'a',p_filters:{payment_method:'cash'},p_from_date:args.from,p_from_ts:args.fromTs});
 });
 it('rejects incomplete datasets and database read limits',async()=>{
  mocks.dataset.mockResolvedValueOnce({data:{rows:[{}],summary:{count:2}},error:null}).mockResolvedValueOnce({data:null,error:{message:'REPORT_SOURCE_LIMIT'}});
  await expect(loadSalesReportRows(args)).rejects.toThrow('REPORT_DATASET_INCOMPLETE');
  await expect(loadSalesReportRows(args)).rejects.toThrow('REPORT_SOURCE_LIMIT');
 });
});
