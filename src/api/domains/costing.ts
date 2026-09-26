import type { ApiResult } from '../types';
import type { CostingOverviewRow, ProductCostingDetail, CostHistoryRow, SupplierPriceImpactRow, OrderMarginRow, RawMaterialCostOverviewRow, RawMaterialCostHistoryRow } from '@/lib/types';
import { rpc } from '../rpc';

type CostingSalesSummary = {
  sales_count: number;
  net_sales: number;
  cogs: number;
  ratio: number;
};

export type RawConsumptionCostBreakdownRow = {
  raw_material_id: string;
  raw_material_name: string;
  raw_material_code: string | null;
  unit_name: string;
  consumed_quantity: number;
  actual_quantity: number;
  estimated_quantity: number;
  actual_cost: number;
  estimated_cost: number;
  displayed_cost: number;
};

export const costing = {
  getOverview(p: { p_branch_id?: string | null }): ApiResult<CostingOverviewRow[]> { return rpc('get_costing_overview', p); },
  getProductDetail(p: { p_product_id: string; p_branch_id?: string | null }): ApiResult<ProductCostingDetail> { return rpc('get_product_costing_detail', p); },
  getCostHistory(p: { p_product_id: string; p_limit?: number }): ApiResult<CostHistoryRow[]> { return rpc('get_cost_history', p); },
  getSupplierPriceImpact(p: { p_supplier_id: string }): ApiResult<SupplierPriceImpactRow[]> { return rpc('get_supplier_price_impact', p); },
  getOrderMargin(p: { p_branch_id?: string | null; p_from?: string | null; p_to?: string | null }): ApiResult<OrderMarginRow[]> { return rpc('get_order_margin', p); },
  getSalesSummary(p: { p_branch_id?: string | null; p_from?: string | null; p_to?: string | null }): ApiResult<CostingSalesSummary> { return rpc('get_costing_sales_summary', p); },
  getRawMaterialCostOverview(p: { p_branch_id?: string | null }): ApiResult<RawMaterialCostOverviewRow[]> { return rpc('get_raw_material_cost_valuation_overview', p); },
  getRawMaterialCostHistory(p: { p_raw_material_id: string; p_branch_id?: string | null; p_limit?: number }): ApiResult<RawMaterialCostHistoryRow[]> { return rpc('get_raw_material_cost_history', p); },
  getRawConsumptionCostBreakdown(p: { p_branch_id: string; p_from: string; p_to: string }): ApiResult<RawConsumptionCostBreakdownRow[]> { return rpc('get_raw_consumption_cost_breakdown', p); },
  setRawMaterialPrice(p: { p_raw_material_id: string; p_branch_id: string; p_unit_cost: number; p_note?: string | null }): ApiResult<{ success: boolean; error?: string; permission?: string; event_id?: string; reference_number?: string; unit_cost?: number; source?: 'pricing'; priced_at?: string }> { return rpc('set_raw_material_price', p); },
};
