import { supabase } from '@/api';

export type RawCurrentPriceRow = {
  raw_material_id: string;
  branch_id: string;
  unit_cost: number | string | null;
  price_source: string;
  priced_at: string | null;
  reference_number: string | null;
};

export function rawCurrentPrice(row: RawCurrentPriceRow | undefined): number | null {
  const value = Number(row?.unit_cost);
  return Number.isFinite(value) && value > 0 ? value : null;
}
export function rawCurrentPriceMap(rows: RawCurrentPriceRow[]): Record<string, number | null> {
  return Object.fromEntries(rows.map(row => [row.raw_material_id, rawCurrentPrice(row)]));
}

/** Latest accessible known price for current estimates; never actual FIFO valuation. */
export async function loadRawCurrentPrices(branchId: string | null, rawIds: string[] | null = null): Promise<RawCurrentPriceRow[]> {
  if (rawIds?.length === 0) return [];
  const rows: RawCurrentPriceRow[] = [];
  for (let from = 0; ; from += 500) {
    const result = await supabase.rpc('get_raw_material_current_prices', {
      p_branch_id: branchId,
      p_raw_material_ids: rawIds,
    }).order('raw_material_id').range(from, from + 499);
    if (result.error) throw result.error;
    const page = (result.data || []) as RawCurrentPriceRow[];
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}
