import {describe,it,expect,vi} from 'vitest';
vi.mock('@/api',()=>({supabase:{}}));
import {saleReceiptOrderMetadata} from '@/features/trade/services/salesPageData';
import {buildReceiptFixedTemplate,buildReceiptThermalText,type ReceiptData} from '@/features/pos/utils/printing';
import type {Settings} from '@/lib/types';
describe('historical customer receipt identity',()=>{
 it('keeps the saved table in both text and template without adding any query',()=>{
  const identity=saleReceiptOrderMetadata({branch_id:'b',table_id:'28',table:{id:'28',branch_id:'b',name:'28'},source_order:{order_number:'O28'}});
  const receipt={...identity,invoice:'I28',branchName:'Branch',items:[],subtotal:0,discount:0,tax:0,total:0,paid:0,change:0,date:'2026-10-26',customerName:''} as ReceiptData;
  expect(buildReceiptThermalText(receipt,{} as Settings,'en',false)).toContain('Table: 28');
  expect(buildReceiptFixedTemplate(receipt,{} as Settings,'en',false).meta).toContainEqual(expect.objectContaining({label:'Table',value:'28'}));
 });
 it('never substitutes a different table or branch, and keeps takeaway table-free',()=>{
  expect(saleReceiptOrderMetadata({branch_id:'b',table_id:'28',table:{id:'29',branch_id:'b',name:'29'}}).tableName).toBeUndefined();
  expect(saleReceiptOrderMetadata({branch_id:'b',table_id:'28',table:{id:'28',branch_id:'other',name:'28'}}).tableName).toBeUndefined();
  expect(saleReceiptOrderMetadata({branch_id:'b',table_id:null,table:null}).tableName).toBeUndefined();
 });
});
