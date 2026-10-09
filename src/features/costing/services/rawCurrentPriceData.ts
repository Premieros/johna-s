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
  // Page the inexpensive identity list, then price bounded sets. Paging the
  // result of the pricing RPC reruns its entire history query for every page.
  const ids = new Set(rawIds || []);
  if (rawIds === null) {
    for (let from = 0; ; from += 500) {
      let query = supabase.from('raw_materials').select('id').order('id').range(from, from + 499);
      if (branchId) query = query.eq('branch_id', branchId);
      const result = await query;
      if (result.error) throw result.error;
      const page = (result.data || []) as Array<{ id: string }>;
      page.forEach(row => ids.add(row.id));
      if (page.length < 500) break;
    }
  }
  const rows: RawCurrentPriceRow[] = [];
  const selected = [...ids].sort();
  // Sequential batches limit database pressure. A failed batch rejects the
  // whole read; no partial price map or invented zero reaches the caller.
  for (let from = 0; from < selected.length; from += 100) {
    const result = await supabase.rpc('get_raw_material_current_prices', {
      p_branch_id: branchId,
      p_raw_material_ids: selected.slice(from, from + 100),
    }).order('raw_material_id');
    if (result.error) throw result.error;
    rows.push(...((result.data || []) as RawCurrentPriceRow[]));
  }
  return rows;
}

/**
 * Canonical read for material cost displays: use actual FIFO inventory cost
 * when present, otherwise the last explicitly known positive price. Never
 * turn unknown/null prices into zero or invent a price.
 */
export function mergeRawFifoKnownPrices(known: RawCurrentPriceRow[], fifoRows: import('./rawFifoCostData').RawFifoCostRow[], rawIds: string[] | null = null): RawCurrentPriceRow[] {
  const byId = new Map(known.map(row => [row.raw_material_id, row]));
  for (const row of fifoRows) {
    if (rawIds !== null && !rawIds.includes(row.raw_material_id)) continue;
    const fifoCost = Number(row.avg_cost);
    if (!Number.isFinite(fifoCost) || fifoCost <= 0) continue;
    const previous = byId.get(row.raw_material_id);
    byId.set(row.raw_material_id, {
      ...(previous || { raw_material_id: row.raw_material_id, branch_id: row.branch_id,
        unit_cost: null, price_source: 'unpriced', priced_at: null, reference_number: null }),
      unit_cost: fifoCost, price_source: 'fifo',
    });
  }
  return [...byId.values()];
}

export async function loadRawMaterialDisplayPrices(branchId: string | null, rawIds: string[] | null = null): Promise<RawCurrentPriceRow[]> {
  const { loadRawFifoCosts } = await import('./rawFifoCostData');
  const fifoRows = await loadRawFifoCosts(branchId, rawIds);
  // Requested material subsets can skip historical price scans for positive FIFO costs.
  const missingIds = rawIds?.filter(id => !fifoRows.some(row =>
    row.raw_material_id === id && Number(row.avg_cost) > 0 && Number.isFinite(Number(row.avg_cost))
  )) ?? null;
  const known = missingIds?.length === 0 ? [] : await loadRawCurrentPrices(branchId, missingIds);
  return mergeRawFifoKnownPrices(known, fifoRows, rawIds);
}
