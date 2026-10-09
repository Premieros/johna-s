import { supabase } from '@/api';

export type RawFifoCostRow = { raw_material_id: string; branch_id: string; avg_cost: number | string | null; updated_at?: string | null };
export function rawFifoCost(row: RawFifoCostRow | undefined): number | null {
  const value = Number(row?.avg_cost);
  return Number.isFinite(value) && value > 0 ? value : null;
}
export function rawFifoCostMap(rows: RawFifoCostRow[]): Record<string, number | null> {
  return Object.fromEntries(rows.map((row) => [row.raw_material_id, rawFifoCost(row)]));
}

// The existing inventory trigger maintains this actual FIFO-layer valuation.
// No purchase/pricing/count reference fallback, and no privileged RPC/RLS bypass.
export async function loadRawFifoCosts(branchId: string | null, rawIds: string[] | null = null): Promise<RawFifoCostRow[]> {
  if (rawIds?.length === 0) return [];
  const rows: RawFifoCostRow[] = [];
  for (let from = 0; ; from += 500) {
    let query = supabase.from('raw_material_inventory')
      .select('raw_material_id,branch_id,avg_cost,updated_at').order('raw_material_id').range(from, from + 499);
    if (branchId) query = query.eq('branch_id', branchId);
    if (rawIds && rawIds.length <= 100) query = query.in('raw_material_id', rawIds);
    const result = await query;
    if (result.error) throw result.error;
    const page = (result.data || []) as RawFifoCostRow[];
    rows.push(...(rawIds ? page.filter(row => rawIds.includes(row.raw_material_id)) : page));
    if (page.length < 500) return rows;
  }
}
