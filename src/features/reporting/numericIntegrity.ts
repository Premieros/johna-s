export interface SaleNumericLike {
  total?: number | string | null;
  paid_amount?: number | string | null;
  refunded_amount?: number | string | null;
  discount_amount?: number | string | null;
  status?: string | null;
}

export interface PurchaseNumericLike {
  total?: number | string | null;
  returned_amount?: number | string | null;
}

export interface SaleItemNumericLike {
  quantity?: number | string | null;
  refunded_quantity?: number | string | null;
  total?: number | string | null;
  refunded_amount?: number | string | null;
}

export interface SalePaymentLike {
  sale_id: string;
  branch_id?: string | null;
  payment_method?: string | null;
  amount?: number | string | null;
  refunded_amount?: number | string | null;
}

export interface SalePaymentFallbackLike extends SaleNumericLike {
  id: string;
  branch_id?: string | null;
  payment_method?: string | null;
}

const n = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const nonNegative = (value: number): number => Math.max(0, value);

export const netSaleAmount = (sale: SaleNumericLike): number =>
  nonNegative(n(sale.total) - n(sale.refunded_amount));

export const netSalePayment = (sale: SaleNumericLike): number =>
  nonNegative(n(sale.paid_amount) - n(sale.refunded_amount));

export const saleRemainingRatio = (sale: SaleNumericLike): number => {
  const status = String(sale.status || '').toLowerCase();
  if (status === 'returned' || status === 'refunded' || status === 'cancelled') return 0;
  const total = nonNegative(n(sale.total));
  if (total <= 0) return 1;
  return Math.min(1, nonNegative(total - n(sale.refunded_amount)) / total);
};

export const netSaleDiscount = (sale: SaleNumericLike): number =>
  nonNegative(n(sale.discount_amount)) * saleRemainingRatio(sale);

export const netPurchaseAmount = (purchase: PurchaseNumericLike): number =>
  nonNegative(n(purchase.total) - n(purchase.returned_amount));

export const netSaleItemQuantity = (item: SaleItemNumericLike): number =>
  nonNegative(n(item.quantity) - n(item.refunded_quantity));

export const netSaleItemRevenue = (item: SaleItemNumericLike): number =>
  nonNegative(n(item.total) - n(item.refunded_amount));

export function allocateSaleNetRevenue(
  itemNetRevenue: number,
  saleNetAmount: number,
  saleItemsNetBase: number,
): number {
  const base = nonNegative(n(saleItemsNetBase));
  if (base <= 0) return 0;
  return nonNegative(n(saleNetAmount)) * (nonNegative(n(itemNetRevenue)) / base);
}

export type PaymentMethodAggregate = {
  branchId: string;
  method: string;
  total: number;
  count: number;
};

/**
 * Canonical report aggregation for tender methods.
 *
 * When sale_payments exist they are the authoritative tender split. For old or
 * simple sales without detail rows, fall back once to sale.paid_amount minus
 * refunded_amount. This deliberately avoids counting both sources.
 */
export function aggregatePaymentMethods(
  sales: SalePaymentFallbackLike[],
  payments: SalePaymentLike[],
): PaymentMethodAggregate[] {
  const bySale = new Map<string, SalePaymentLike[]>();
  payments.forEach((payment) => {
    const list = bySale.get(payment.sale_id) || [];
    list.push(payment);
    bySale.set(payment.sale_id, list);
  });

  const totals = new Map<string, PaymentMethodAggregate>();
  const add = (branchId: string, method: string, amount: number) => {
    if (amount <= 0) return;
    const key = `${branchId}\u0000${method}`;
    const current = totals.get(key) || { branchId, method, total: 0, count: 0 };
    current.total += amount;
    current.count += 1;
    totals.set(key, current);
  };

  sales.forEach((sale) => {
    const detail = bySale.get(sale.id) || [];
    if (detail.length > 0) {
      detail.forEach((payment) => {
        add(
          String(payment.branch_id || sale.branch_id || ''),
          String(payment.payment_method || 'other').toLowerCase(),
          nonNegative(n(payment.amount) - n(payment.refunded_amount)),
        );
      });
      return;
    }

    add(
      String(sale.branch_id || ''),
      String(sale.payment_method || 'other').toLowerCase(),
      netSalePayment(sale),
    );
  });

  return [...totals.values()].sort((a, b) => b.total - a.total);
}
