import type { ApiResult, JournalLineInput } from '../types';
import type { RpcResult, TreasuryBalance, TreasurySource, TrialBalanceRow, JournalDto, ArAgingRow, ApAgingRow, ReconciliationDetail } from '@/lib/types';
import { rpc } from '../rpc';

export const accounting = {
  postShiftExpense(p: {
    p_idempotency_key: string;
    p_branch_id: string;
    p_shift_id: string;
    p_category: string;
    p_description: string | null;
    p_amount: number;
    p_payment_method: string;
    p_expense_account_id: string;
    p_treasury_account_id: string;
    p_expense_date: string;
    p_notes: string | null;
  }): ApiResult<RpcResult & { expense_id?: string; journal_entry_id?: string; already_posted?: boolean }> {
    return rpc('post_shift_expense', p);
  },
  reverseShiftExpense(p: { p_expense_id: string; p_reason: string }): ApiResult<RpcResult & { journal_entry_id?: string; already_reversed?: boolean }> {
    return rpc('reverse_shift_expense', p);
  },
  editShiftExpense(p: {
    p_expense_id: string;
    p_idempotency_key: string;
    p_category: string;
    p_description: string | null;
    p_amount: number;
    p_payment_method: string;
    p_expense_account_id: string;
    p_treasury_account_id: string;
    p_expense_date: string;
    p_notes: string | null;
    p_reason: string;
  }): ApiResult<RpcResult & { old_expense_id?: string; replacement_expense_id?: string; journal_entry_id?: string }> {
    return rpc('edit_shift_expense', p);
  },
  getExpenseRoutingRules(p: { p_branch_id: string }): ApiResult<Array<{
    id: string;
    category: string;
    expense_account_id: string;
    expense_account_code: string;
    expense_account_name: string;
    treasury_account_id: string;
    treasury_account_name: string;
    treasury_account_type: string;
    payment_method: string;
    is_active: boolean;
  }>> {
    return rpc('get_expense_routing_rules', p);
  },
  upsertExpenseRoutingRule(p: {
    p_branch_id: string;
    p_category: string;
    p_expense_account_id: string;
    p_treasury_account_id: string;
    p_payment_method: string;
    p_is_active: boolean;
  }): ApiResult<RpcResult & { id?: string }> {
    return rpc('upsert_expense_routing_rule', p);
  },
  getTrialBalance(p: { p_branch_id: string | null; p_to_date: string }): ApiResult<TrialBalanceRow[]> { return rpc('get_trial_balance', p); },
  seedOpeningBalances(p: { p_branch_id: string | null }): ApiResult<RpcResult> { return rpc('seed_opening_balances', p); },
  getJournals(p: { p_branch_id: string | null; p_from_date: string | null; p_to_date: string | null; p_reference_type: string | null; p_search: string | null }): ApiResult<JournalDto[]> { return rpc('get_journals', p); },
  postManualJournal(p: { p_branch_id: string | null; p_description: string; p_lines: JournalLineInput[] }): ApiResult<RpcResult> { return rpc('post_manual_journal', p); },
  getArAging(p: { p_branch_id: string | null; p_as_of: string }): ApiResult<ArAgingRow[]> { return rpc('get_ar_aging', p); },
  getApAging(p: { p_branch_id: string | null; p_as_of: string }): ApiResult<ApAgingRow[]> { return rpc('get_ap_aging', p); },
  getSupplierStatement(p: { p_supplier_id: string; p_branch_id: string }): ApiResult<unknown> { return rpc('get_supplier_statement', p); },
  linkEmployeeCreditAccount(p: { p_customer_id: string; p_employee_id: string; p_branch_id: string }): ApiResult<RpcResult> { return rpc('link_employee_credit_account', p); },
  getEmployeeCreditBalances(p: { p_branch_id: string }): ApiResult<unknown> { return rpc('get_employee_credit_balances', p); },
  receivePayment(p: { p_customer_id: string; p_branch_id: string | null; p_amount: number; p_payment_method: string; p_sale_id: string | null; p_notes: string | null }): ApiResult<RpcResult> { return rpc('receive_payment', p); },
  receiveEmployeeCreditPayment(p: { p_employee_id: string; p_branch_id: string; p_amount: number; p_payment_method: string; p_sale_id: string | null; p_notes: string | null }): ApiResult<RpcResult> { return rpc('receive_employee_credit_payment', p); },
  paySupplier(p: { p_supplier_id: string; p_branch_id: string | null; p_amount: number; p_payment_method: string; p_purchase_id: string | null; p_notes: string | null }): ApiResult<RpcResult> { return rpc('pay_supplier', p); },
  paySupplierFromTreasury(p: { p_supplier_id: string; p_branch_id: string; p_amount: number; p_treasury_account_id: string; p_purchase_id: string | null; p_notes: string | null }): ApiResult<RpcResult> { return rpc('pay_supplier_from_treasury', p); },
  getTreasuryBalances(p: { p_branch_id: string | null }): ApiResult<TreasuryBalance[]> { return rpc('get_treasury_balances', p); },
  getAccessibleTreasuryAccounts(p: { p_branch_id: string }): ApiResult<TreasurySource[]> { return rpc('get_accessible_treasury_accounts', p); },
  getBranchTreasuryDayCloseReconciliation(p: { p_branch_id: string; p_limit: number }): ApiResult<{
    success: boolean;
    branch_id?: string;
    error?: string;
    rows?: Array<{
      daily_close_id: string;
      business_date: string;
      closed_at: string;
      cash_sales: number;
      bank_sales: number;
      credit_sales: number;
      net_sales: number;
      expenses: number;
      cash_purchases: number;
      cash_balance_after_close: number;
      bank_balance_after_close: number;
      total_balance_after_close: number;
      previous_cash_balance: number | null;
      previous_bank_balance: number | null;
      previous_total_balance: number | null;
      cash_movement_since_previous_close: number | null;
      bank_movement_since_previous_close: number | null;
      total_movement_since_previous_close: number | null;
    }>;
  }> { return rpc('get_branch_treasury_day_close_reconciliation', p); },
  processTransfer(p: { p_branch_id: string | null; p_from_account_id: string; p_to_account_id: string; p_amount: number; p_notes: string | null }): ApiResult<RpcResult> { return rpc('process_transfer', p); },
  processTreasuryTransferV2(p: { p_from_account_id: string; p_to_account_id: string; p_amount: number; p_notes: string | null }): ApiResult<RpcResult> { return rpc('process_treasury_transfer_v2', p); },
  processTreasuryDeposit(p: { p_branch_id: string | null; p_account_id: string; p_amount: number; p_notes: string | null }): ApiResult<RpcResult> { return rpc('process_treasury_deposit', p); },
  processTreasuryWithdrawal(p: { p_branch_id: string | null; p_account_id: string; p_amount: number; p_notes: string | null }): ApiResult<RpcResult> { return rpc('process_treasury_withdrawal', p); },
  getBankReconciliation(p: { p_reconciliation_id: string }): ApiResult<ReconciliationDetail> { return rpc('get_bank_reconciliation', p); },
  createBankReconciliation(p: { p_branch_id: string | null; p_treasury_account_id: string; p_statement_date: string; p_statement_balance: number }): ApiResult<RpcResult> { return rpc('create_bank_reconciliation', p); },
  addStatementLine(p: { p_reconciliation_id: string; p_statement_date: string; p_description: string | null; p_amount: number; p_reference: string | null }): ApiResult<RpcResult> { return rpc('add_statement_line', p); },
  matchBankLine(p: { p_line_id: string; p_journal_entry_id: string }): ApiResult<RpcResult> { return rpc('match_bank_line', p); },
  completeBankReconciliation(p: { p_reconciliation_id: string }): ApiResult<RpcResult> { return rpc('complete_bank_reconciliation', p); },
};
