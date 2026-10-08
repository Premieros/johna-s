import type { HistoricalSaleCostEstimate } from '@/api/domains/costing';
import type { OrderMarginRow } from '@/lib/types';

export type HistoricalOrderMargin = OrderMarginRow & { estimated_cost: number; displayed_cost: number; displayed_margin: number; unpriced_movements: number };

export function supplementHistoricalMargins(rows: OrderMarginRow[], estimates: HistoricalSaleCostEstimate[]): HistoricalOrderMargin[] {
  const bySale = new Map(estimates.map(row => [row.sale_id, row]));
  return rows.map(row => {
    const estimate = bySale.get(row.sale_id);
    const estimated_cost = Number(estimate?.estimated_cost || 0);
    const displayed_cost = Math.round((Number(row.cogs) + estimated_cost) * 100) / 100;
    return { ...row, estimated_cost, displayed_cost, displayed_margin: Math.round((Number(row.total) - displayed_cost) * 100) / 100, unpriced_movements: Number(estimate?.unpriced_movements || 0) };
  });
}
