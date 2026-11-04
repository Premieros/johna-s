import { inventory } from '@/api';
import type { RawStockSummaryRow } from '@/lib/types';
import type { RawCurrentPriceRow } from '@/features/costing/services/rawCurrentPriceData';

/** Current stock and price share one bounded server projection; no FIFO overlay. */
export async function loadRawStockSummary(branchId: string | null): Promise<RawStockSummaryRow[]> {
  const rows: RawStockSummaryRow[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await inventory.getRawMaterialStockSummary({
      p_branch_id: branchId, p_offset: offset, p_limit: 500,
    });
    if (error) throw error;
    const page = (data || []) as RawStockSummaryRow[];
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}

export function stockSummaryPrices(rows: RawStockSummaryRow[]): RawCurrentPriceRow[] {
  return rows.map(row => ({
    raw_material_id: row.raw_material_id, branch_id: row.branch_id,
    unit_cost: row.avg_cost, price_source: row.price_source,
    priced_at: row.priced_at, reference_number: row.reference_number,
  }));
}
