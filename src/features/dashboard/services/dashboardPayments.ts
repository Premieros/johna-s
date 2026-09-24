import { reporting, supabase } from '@/api';
import {
  aggregatePaymentMethods,
  type PaymentMethodAggregate,
  type SalePaymentFallbackLike,
  type SalePaymentLike,
} from '@/features/reporting/numericIntegrity';

const PAYMENT_ID_CHUNK_SIZE = 100;
const PAYMENT_CHUNK_CONCURRENCY = 4;

type PaymentReportRow = {
  branch_id?: string | null;
  method?: string | null;
  invoice_count?: number | string | null;
  sales_total?: number | string | null;
};

type PaymentReportPayload = {
  success?: boolean;
  rows?: PaymentReportRow[];
};

export type DashboardPaymentLoadArgs = {
  sales: SalePaymentFallbackLike[];
  from: string;
  to: string;
  orderType?: string | null;
};

function saleBranchIds(sales: SalePaymentFallbackLike[]): string[] {
  return [...new Set(sales.map((sale) => String(sale.branch_id || '')).filter(Boolean))];
}

function normalizeReportRows(payloads: Array<{ branchId: string; payload: PaymentReportPayload }>): PaymentMethodAggregate[] {
  return payloads
    .flatMap(({ branchId, payload }) =>
      (payload.rows || []).map((row) => ({
        branchId: String(row.branch_id || branchId),
        method: String(row.method || 'other').toLowerCase(),
        total: Number(row.sales_total || 0),
        count: Number(row.invoice_count || 0),
      })),
    )
    .filter((row) => Number.isFinite(row.total) && row.total > 0)
    .sort((a, b) => b.total - a.total);
}

async function loadViaReportRpc({
  sales,
  from,
  to,
  orderType,
}: DashboardPaymentLoadArgs): Promise<PaymentMethodAggregate[] | null> {
  const branchIds = saleBranchIds(sales);
  if (branchIds.length === 0) return [];

  const results = await Promise.all(
    branchIds.map(async (branchId) => {
      const result = await reporting.getSalesByPaymentReport({
        p_branch_id: branchId,
        p_from: from,
        p_to: to,
        p_payment_method: null,
        p_order_type: orderType || null,
        p_warehouse_id: null,
        p_cashier_id: null,
        p_status: null,
      });
      const payload = (result.data || {}) as PaymentReportPayload;
      if (result.error || payload.success === false || !Array.isArray(payload.rows)) return null;
      return { branchId, payload };
    }),
  );

  if (results.some((result) => result === null)) return null;
  return normalizeReportRows(results as Array<{ branchId: string; payload: PaymentReportPayload }>);
}

function chunks<T>(rows: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    result.push(rows.slice(index, index + size));
  }
  return result;
}

async function loadViaBoundedDetails(sales: SalePaymentFallbackLike[]): Promise<PaymentMethodAggregate[]> {
  if (sales.length === 0) return [];

  const idChunks = chunks(sales.map((sale) => sale.id), PAYMENT_ID_CHUNK_SIZE);
  const paymentRows: SalePaymentLike[] = [];

  for (let index = 0; index < idChunks.length; index += PAYMENT_CHUNK_CONCURRENCY) {
    const wave = idChunks.slice(index, index + PAYMENT_CHUNK_CONCURRENCY);
    const results = await Promise.all(
      wave.map((saleIds) =>
        supabase
          .from('sale_payments')
          .select('sale_id,branch_id,payment_method,amount,refunded_amount')
          .in('sale_id', saleIds)
          .limit(5000),
      ),
    );

    for (const result of results) {
      if (result.error) throw result.error;
      paymentRows.push(...((result.data || []) as SalePaymentLike[]));
    }
  }

  return aggregatePaymentMethods(sales, paymentRows);
}

/**
 * Dashboard payment loader:
 * 1) Prefer the canonical server-side payment report to keep payloads tiny.
 * 2) If the caller lacks report permission (or the RPC is otherwise unavailable),
 *    preserve sales-view-only dashboard access with bounded sale-id chunks.
 */
export async function loadDashboardPaymentAggregates(
  args: DashboardPaymentLoadArgs,
): Promise<PaymentMethodAggregate[]> {
  const reported = await loadViaReportRpc(args);
  if (reported !== null) return reported;
  return loadViaBoundedDetails(args.sales);
}
