export interface CostingOverviewRow {
  product_id: string;
  product_name: string;
  barcode: string | null;
  sku: string | null;
  category_name: string | null;
  product_type: string;
  sale_price: number;
  unit_cost: number;
  theoretical_cost: number;
  actual_cost: number;
  component_count: number;
  recipe_item_count: number;
}

export interface CostingComponentLine {
  component_product_id: string;
  component_name: string;
  quantity: number;
  unit_cost: number;
  line_cost: number;
}

export interface CostingRecipeLine {
  raw_material_id: string;
  raw_material_name: string;
  quantity: number;
  wastage_percent: number;
  unit_cost: number;
  line_cost: number;
  cost_source?: RawMaterialPriceSource;
  cost_priced_at?: string | null;
  cost_reference?: string | null;
  cost_detail?: string | null;
}

export type RawMaterialPriceSource =
  | 'purchase'
  | 'stock_count'
  | 'inventory_average'
  | 'batch_average'
  | 'default_cost';

export interface RawMaterialCostOverviewRow {
  raw_material_id: string;
  raw_material_name: string;
  raw_material_code: string | null;
  branch_id: string;
  latest_cost: number;
  previous_cost: number | null;
  change_amount: number | null;
  change_pct: number | null;
  price_source: RawMaterialPriceSource;
  priced_at: string | null;
  reference_number: string | null;
  source_detail: string | null;
  event_count: number;
}

export interface RawMaterialCostHistoryRow {
  event_id: string;
  raw_material_id: string;
  raw_material_name: string;
  branch_id: string;
  unit_cost: number;
  previous_cost: number | null;
  change_amount: number | null;
  change_pct: number | null;
  price_source: 'purchase' | 'stock_count';
  priced_at: string;
  reference_number: string | null;
  source_detail: string | null;
}

export interface CostHistoryRow {
  id: string;
  product_id: string;
  old_cost: number;
  new_cost: number;
  changed_at: string;
  changed_by: string;
  source: string;
}

export interface ProductCostingDetail {
  success: boolean;
  error?: string;
  product_id?: string;
  product_name?: string;
  barcode?: string | null;
  sku?: string | null;
  sale_price?: number;
  unit_cost?: number;
  theoretical_cost?: number;
  actual_cost?: number;
  component_count?: number;
  recipe_item_count?: number;
  components?: CostingComponentLine[];
  recipe_items?: CostingRecipeLine[];
  history?: CostHistoryRow[];
}

export interface SupplierPriceImpactRow {
  item_id: string;
  item_type: 'product' | 'raw_material';
  item_name: string;
  first_cost: number;
  last_cost: number;
  avg_cost: number;
  change_pct: number;
  purchase_count: number;
  last_purchased_at: string | null;
}

export interface OrderMarginRow {
  sale_id: string;
  invoice_number: string;
  branch_id: string | null;
  sale_date: string;
  total: number;
  discount_amount: number;
  cogs: number;
  gross_margin: number;
}
