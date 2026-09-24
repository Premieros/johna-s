import type { ApiResult } from '../types';
import type { TrialBalanceRow, TrialBalanceSummary, GeneralLedgerRow, IncomeStatementResult, BalanceSheetResult, ArAgingRow, ApAgingRow, AgingSummaryResult, CashFlowRow, PartyStatementResult, TreasuryStatementResult, InventoryItemStatementResult } from '@/lib/types';
import { rpc } from '../rpc';

export const reporting = {
  getTrialBalance(p: { p_branch_id: string | null; p_to_date: string }): ApiResult<TrialBalanceRow[]> { return rpc('get_trial_balance', p); },
  getTrialBalanceSummary(p: { p_branch_id: string | null; p_to_date: string }): ApiResult<TrialBalanceSummary> { return rpc('get_trial_balance_summary', p); },
  getGeneralLedger(p: { p_branch_id: string | null; p_account_id: string | null; p_from_date: string | null; p_to_date: string | null }): ApiResult<GeneralLedgerRow[]> { return rpc('get_general_ledger', p); },
  getIncomeStatement(p: { p_branch_id: string | null; p_from_date: string; p_to_date: string }): ApiResult<IncomeStatementResult> { return rpc('get_income_statement', p); },
  getBalanceSheet(p: { p_branch_id: string | null; p_as_of: string }): ApiResult<BalanceSheetResult> { return rpc('get_balance_sheet', p); },
  getArAging(p: { p_branch_id: string | null; p_as_of: string }): ApiResult<ArAgingRow[]> { return rpc('get_ar_aging', p); },
  getApAging(p: { p_branch_id: string | null; p_as_of: string }): ApiResult<ApAgingRow[]> { return rpc('get_ap_aging', p); },
  getAgingSummary(p: { p_branch_id: string | null; p_as_of: string }): ApiResult<AgingSummaryResult> { return rpc('get_aging_summary', p); },
  getCashFlow(p: { p_branch_id: string | null; p_from_date: string; p_to_date: string }): ApiResult<CashFlowRow[]> { return rpc('get_cash_flow', p); },
  getPartyStatement(p: { p_branch_id: string | null; p_side: string; p_party_id: string | null; p_from_date: string | null; p_to_date: string | null }): ApiResult<PartyStatementResult> { return rpc('get_party_statement', p); },
  getTreasuryAccountStatement(p: { p_branch_id: string; p_treasury_account_id: string; p_from_date: string; p_to_date: string }): ApiResult<TreasuryStatementResult> { return rpc('get_treasury_account_statement', p); },
  getInventoryItemStatement(p: { p_branch_id: string; p_item_type: 'product' | 'raw_material'; p_item_id: string; p_warehouse_id: string | null; p_from_date: string | null; p_to_date: string | null }): ApiResult<InventoryItemStatementResult> { return rpc('get_inventory_item_statement', p); },
  getSalesByPaymentReport(p: { p_branch_id: string; p_from: string; p_to: string; p_payment_method: string | null }): ApiResult<RpcResult & Record<string, unknown>> { return rpc('get_sales_by_payment_report', p); },
  getFinancialReconciliationReport(p: { p_branch_id: string; p_from: string; p_to: string }): ApiResult<RpcResult & Record<string, unknown>> { return rpc('get_financial_reconciliation_report', p); },

};
