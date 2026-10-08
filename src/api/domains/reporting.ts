import type { ApiResult } from '../types';
import type { TrialBalanceRow, TrialBalanceSummary, GeneralLedgerRow, IncomeStatementResult, BalanceSheetResult, ArAgingRow, ApAgingRow, AgingSummaryResult, CashFlowRow, PartyStatementResult, TreasuryStatementResult, InventoryItemStatementResult } from '@/lib/types';
import { rpc } from '../rpc';

export type OperationalReportPage = {
  rows: Record<string, unknown>[];
  summary: { total: number; count: number };
};

export type OperationalStockSource = Record<'rawRows' | 'unitRows' | 'rawMasters' | 'rawBalances' | 'unitMasters' | 'unitBatches', Record<string, unknown>[]>;

export const reporting = {
  getOperationalStockSource(p: { p_branch_id: string | null; p_warehouse_id: string | null; p_low_stock: boolean }, signal?: AbortSignal): ApiResult<OperationalStockSource> { return rpc('get_operational_stock_source', p, signal); },
  getOperationalReportMetrics(p: { p_report_type: 'sales' | 'purchases' | 'expenses'; p_branch_id: string | null; p_from_date: string; p_to_date: string; p_filters: Record<string, string>; p_from_ts: string; p_to_exclusive_ts: string }, signal?: AbortSignal): ApiResult<Record<string, number>> { return rpc('get_operational_report_metrics', p, signal); },
  getOperationalReportDataset(p: { p_report_type: 'sales' | 'purchases' | 'expenses'; p_branch_id: string | null; p_from_date: string; p_to_date: string; p_filters: Record<string, string>; p_from_ts: string; p_to_exclusive_ts: string }, signal?: AbortSignal): ApiResult<OperationalReportPage> { return rpc('get_operational_report_dataset', p, signal); },
  getOperationalReportPage(p: { p_report_type: 'sales' | 'purchases' | 'expenses'; p_branch_id: string | null; p_from_date: string; p_to_date: string; p_filters: Record<string, string>; p_page: number; p_page_size: number; p_from_ts: string; p_to_exclusive_ts: string }): ApiResult<OperationalReportPage> { return rpc('get_operational_report_page', p); },
  getTrialBalance(p: { p_branch_id: string | null; p_to_date: string }, signal?: AbortSignal): ApiResult<TrialBalanceRow[]> { return rpc('get_trial_balance', p, signal); },
  getTrialBalanceSummary(p: { p_branch_id: string | null; p_to_date: string }): ApiResult<TrialBalanceSummary> { return rpc('get_trial_balance_summary', p); },
  getGeneralLedger(p: { p_branch_id: string | null; p_account_id: string | null; p_from_date: string | null; p_to_date: string | null }, signal?: AbortSignal): ApiResult<GeneralLedgerRow[]> { return rpc('get_general_ledger', p, signal); },
  getIncomeStatement(p: { p_branch_id: string | null; p_from_date: string; p_to_date: string }, signal?: AbortSignal): ApiResult<IncomeStatementResult> { return rpc('get_income_statement', p, signal); },
  getBalanceSheet(p: { p_branch_id: string | null; p_as_of: string }, signal?: AbortSignal): ApiResult<BalanceSheetResult> { return rpc('get_balance_sheet', p, signal); },
  getArAging(p: { p_branch_id: string | null; p_as_of: string }, signal?: AbortSignal): ApiResult<ArAgingRow[]> { return rpc('get_ar_aging', p, signal); },
  getApAging(p: { p_branch_id: string | null; p_as_of: string }, signal?: AbortSignal): ApiResult<ApAgingRow[]> { return rpc('get_ap_aging', p, signal); },
  getAgingSummary(p: { p_branch_id: string | null; p_as_of: string }, signal?: AbortSignal): ApiResult<AgingSummaryResult> { return rpc('get_aging_summary', p, signal); },
  getCashFlow(p: { p_branch_id: string | null; p_from_date: string; p_to_date: string }, signal?: AbortSignal): ApiResult<CashFlowRow[]> { return rpc('get_cash_flow', p, signal); },
  getPartyStatement(p: { p_branch_id: string | null; p_side: string; p_party_id: string | null; p_from_date: string | null; p_to_date: string | null }, signal?: AbortSignal): ApiResult<PartyStatementResult> { return rpc('get_party_statement', p, signal); },
  getTreasuryAccountStatement(p: { p_branch_id: string; p_treasury_account_id: string; p_from_date: string; p_to_date: string }, signal?: AbortSignal): ApiResult<TreasuryStatementResult> { return rpc('get_treasury_account_statement', p, signal); },
  getInventoryItemStatement(p: { p_branch_id: string; p_item_type: 'product' | 'raw_material'; p_item_id: string; p_warehouse_id: string | null; p_from_date: string | null; p_to_date: string | null }, signal?: AbortSignal): ApiResult<InventoryItemStatementResult> { return rpc('get_inventory_item_statement', p, signal); },
  getSalesByPaymentReport(p: { p_branch_id: string; p_from: string; p_to: string; p_payment_method: string | null; p_order_type: string | null; p_warehouse_id: string | null; p_cashier_id: string | null; p_status: string | null }): ApiResult<Record<string, unknown>> { return rpc('get_sales_by_payment_report', p); },
  getFinancialReconciliationReport(p: { p_branch_id: string; p_from: string; p_to: string }): ApiResult<Record<string, unknown>> { return rpc('get_financial_reconciliation_report', p); },
  getDashboardSalesSnapshot(p: { p_branch_id: string | null; p_current_from: string; p_current_to: string; p_previous_from: string; p_previous_to: string; p_granularity: 'hour' | 'day' | 'month'; p_timezone: string }): ApiResult<Record<string, unknown>> { return rpc('get_dashboard_sales_snapshot', p); },

  getDayClosingRangeReport(p: { p_branch_id: string; p_from_date: string; p_to_date: string }): ApiResult<Record<string, unknown>> { return rpc('get_day_closing_range_report', p); },
  getRawMaterialConsumptionReport(p: { p_branch_id: string; p_from_date: string; p_to_date: string }, signal?: AbortSignal): ApiResult<Record<string, unknown>[]> { return rpc('get_raw_material_consumption_report', p, signal); },
  getCurrentRawMaterialValuation(p: { p_branch_id: string }): ApiResult<Record<string, unknown>[]> { return rpc('get_current_raw_material_valuation', p); },
  getRawMaterialFinancialReport(p: { p_branch_id: string; p_from_date: string; p_to_date: string }): ApiResult<Record<string, unknown>> { return rpc('get_raw_material_financial_report', p); },
  getSalesComponentReconciliationReport(p: { p_branch_id: string; p_from_date: string; p_to_date: string }): ApiResult<Record<string, unknown>> { return rpc('get_sales_component_reconciliation_report', p); },

};
