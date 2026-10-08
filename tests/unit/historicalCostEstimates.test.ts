import { describe, expect, it } from 'vitest';
import { supplementHistoricalMargins } from '@/features/costing/services/historicalCostEstimates';

describe('historical cost supplement', () => {
  it('adds zero-material known cost to existing positive actual cost and corrects margin', () => {
    const actual = { sale_id: 'a', invoice_number: 'A', branch_id: 'b', sale_date: '2026-10-01', total: 100, discount_amount: 0, cogs: 6.6, gross_margin: 93.4 };
    const rows = supplementHistoricalMargins([actual], [{ sale_id: 'a', estimated_cost: 0.42, priced_movements: 1, unpriced_movements: 1 }]);
    expect(rows[0]).toMatchObject({ cogs: 6.6, gross_margin: 93.4, displayed_cost: 7.02, displayed_margin: 92.98, unpriced_movements: 1 });
    expect(actual.cogs).toBe(6.6);
  });
  it('matches estimates by invoice and keeps known costs when other ingredients remain unpriced', () => {
    const rows = supplementHistoricalMargins([{ sale_id: 'b', invoice_number: 'B', branch_id: 'b', sale_date: '2026-10-01', total: 50, discount_amount: 0, cogs: 10, gross_margin: 40 }], [{ sale_id: 'a', estimated_cost: 999, priced_movements: 1, unpriced_movements: 0 }]);
    expect(rows[0].displayed_cost).toBe(10);
    expect(rows[0].displayed_margin).toBe(40);
  });
});
