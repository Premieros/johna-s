import { reporting } from '@/api';
import type { PaymentMethodAggregate } from '@/features/reporting/numericIntegrity';

export type DashboardSummary = {
  orders: number;
  sales: number;
  payments: number;
  returns: number;
  discounts: number;
};

export type DashboardSeriesRow = { bucket: string; sales: number };
export type DashboardOrderTypeRow = { key: string; count: number };
export type DashboardBranchRow = { branchId: string; orders: number; sales: number };
export type DashboardProductRow = { name: string; quantity: number };
export type DashboardRecentSale = {
  id: string;
  invoice_number: string | null;
  branch_id: string | null;
  created_at: string;
  order_type: string | null;
  total: number | null;
  refunded_amount: number | null;
};

export type DashboardSalesSnapshot = {
  current: DashboardSummary;
  previous: DashboardSummary;
  orderTypes: DashboardOrderTypeRow[];
  branches: DashboardBranchRow[];
  recentSales: DashboardRecentSale[];
  topProducts: DashboardProductRow[];
  currentSeries: DashboardSeriesRow[];
  previousSeries: DashboardSeriesRow[];
  paymentMethods: PaymentMethodAggregate[];
  previousPaymentMethods: PaymentMethodAggregate[];
};

type RawSnapshot = {
  current?: Record<string, unknown>;
  previous?: Record<string, unknown>;
  order_types?: Array<Record<string, unknown>>;
  branches?: Array<Record<string, unknown>>;
  recent_sales?: Array<Record<string, unknown>>;
  top_products?: Array<Record<string, unknown>>;
  current_series?: Array<Record<string, unknown>>;
  previous_series?: Array<Record<string, unknown>>;
  payment_methods?: Array<Record<string, unknown>>;
  previous_payment_methods?: Array<Record<string, unknown>>;
};

const n = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

function summary(row: Record<string, unknown> | undefined): DashboardSummary {
  return {
    orders: n(row?.orders),
    sales: n(row?.sales),
    payments: n(row?.payments),
    returns: n(row?.returns),
    discounts: n(row?.discounts),
  };
}

function paymentRows(rows: Array<Record<string, unknown>> | undefined): PaymentMethodAggregate[] {
  return (rows || []).map((row) => ({
    branchId: String(row.branch_id || ''),
    method: String(row.method || 'other').toLowerCase(),
    total: n(row.total),
    count: n(row.count),
  }));
}

export async function loadDashboardSalesSnapshot(args: {
  branchId: string | null;
  currentFrom: string;
  currentTo: string;
  previousFrom: string;
  previousTo: string;
  granularity: 'hour' | 'day' | 'month';
  timezone?: string;
}): Promise<DashboardSalesSnapshot | null> {
  const result = await reporting.getDashboardSalesSnapshot({
    p_branch_id: args.branchId,
    p_current_from: args.currentFrom,
    p_current_to: args.currentTo,
    p_previous_from: args.previousFrom,
    p_previous_to: args.previousTo,
    p_granularity: args.granularity,
    p_timezone: args.timezone || 'Africa/Cairo',
  });

  if (result.error || !result.data || typeof result.data !== 'object') return null;
  const raw = result.data as RawSnapshot;

  return {
    current: summary(raw.current),
    previous: summary(raw.previous),
    orderTypes: (raw.order_types || []).map((row) => ({ key: String(row.key || 'other'), count: n(row.count) })),
    branches: (raw.branches || []).map((row) => ({ branchId: String(row.branch_id || ''), orders: n(row.orders), sales: n(row.sales) })),
    recentSales: (raw.recent_sales || []).map((row) => ({
      id: String(row.id || ''),
      invoice_number: row.invoice_number == null ? null : String(row.invoice_number),
      branch_id: row.branch_id == null ? null : String(row.branch_id),
      created_at: String(row.created_at || ''),
      order_type: row.order_type == null ? null : String(row.order_type),
      total: row.total == null ? null : n(row.total),
      refunded_amount: row.refunded_amount == null ? null : n(row.refunded_amount),
    })),
    topProducts: (raw.top_products || []).map((row) => ({ name: String(row.name || 'Unknown'), quantity: n(row.quantity) })),
    currentSeries: (raw.current_series || []).map((row) => ({ bucket: String(row.bucket || ''), sales: n(row.sales) })),
    previousSeries: (raw.previous_series || []).map((row) => ({ bucket: String(row.bucket || ''), sales: n(row.sales) })),
    paymentMethods: paymentRows(raw.payment_methods),
    previousPaymentMethods: paymentRows(raw.previous_payment_methods),
  };
}
