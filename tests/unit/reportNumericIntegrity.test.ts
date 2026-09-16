import { describe, expect, it } from 'vitest';
import {
  aggregatePaymentMethods,
  netPurchaseAmount,
  netSaleAmount,
  netSaleItemQuantity,
  netSaleItemRevenue,
  netSalePayment,
} from '../../src/features/reporting/numericIntegrity';

describe('report numeric integrity', () => {
  it('nets sales, purchases and sale items without going below zero', () => {
    expect(netSaleAmount({ total: 420, refunded_amount: 420 })).toBe(0);
    expect(netSaleAmount({ total: 420, refunded_amount: 120 })).toBe(300);
    expect(netSalePayment({ paid_amount: 420, refunded_amount: 120 })).toBe(300);
    expect(netPurchaseAmount({ total: 1000, returned_amount: 250 })).toBe(750);
    expect(netSaleItemQuantity({ quantity: 4, refunded_quantity: 1 })).toBe(3);
    expect(netSaleItemRevenue({ total: 400, refunded_amount: 100 })).toBe(300);
    expect(netSaleAmount({ total: 100, refunded_amount: 150 })).toBe(0);
  });

  it('uses sale_payments as tender truth and only falls back for sales without details', () => {
    const rows = aggregatePaymentMethods(
      [
        { id: 'split', branch_id: 'b1', payment_method: 'split', total: 100, paid_amount: 100, refunded_amount: 0 },
        { id: 'legacy', branch_id: 'b1', payment_method: 'cash', total: 50, paid_amount: 50, refunded_amount: 10 },
        { id: 'returned', branch_id: 'b1', payment_method: 'card', total: 20, paid_amount: 20, refunded_amount: 20 },
      ],
      [
        { sale_id: 'split', branch_id: 'b1', payment_method: 'cash', amount: 60, refunded_amount: 0 },
        { sale_id: 'split', branch_id: 'b1', payment_method: 'card', amount: 40, refunded_amount: 0 },
      ],
    );

    expect(rows).toEqual([
      { branchId: 'b1', method: 'cash', total: 100, count: 2 },
      { branchId: 'b1', method: 'card', total: 40, count: 1 },
    ]);
  });
});
