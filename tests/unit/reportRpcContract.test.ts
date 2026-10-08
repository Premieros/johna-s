import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const contract = JSON.parse(readFileSync('supabase/api-contract.json', 'utf8')) as { rpcs: { name: string; params: string[] }[] };
describe('abortable reporting API schema contract', () => {
  it('retains every abortable financial and canonical source RPC with its database parameters', () => {
    for (const name of ['get_trial_balance','get_general_ledger','get_income_statement','get_balance_sheet','get_ar_aging','get_ap_aging','get_aging_summary','get_cash_flow','get_party_statement','get_inventory_item_statement','get_operational_report_dataset','get_operational_report_metrics']) {
      expect(contract.rpcs.find(row => row.name === name)?.params).toContain('branch_id');
    }
    expect(contract.rpcs.find(row => row.name === 'get_operational_stock_source')?.params).toEqual(['branch_id','low_stock','warehouse_id']);
  });
});
