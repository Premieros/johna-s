import { describe, expect, it, vi } from 'vitest';
vi.mock('@/api', () => ({ supabase: {} }));
import { mergeRawFifoKnownPrices, rawCurrentPriceMap, type RawCurrentPriceRow } from '@/features/costing/services/rawCurrentPriceData';

const known = (id: string, cost: number | null): RawCurrentPriceRow => ({
  raw_material_id: id, branch_id: 'b', unit_cost: cost,
  price_source: cost === null ? 'unpriced' : 'pricing', priced_at: null, reference_number: null,
});
describe('unified raw material cost display', () => {
  it('prioritizes positive recorded FIFO cost over previous explicit price', () => {
    const rows = mergeRawFifoKnownPrices([known('a', 14)], [{ raw_material_id: 'a', branch_id: 'b', avg_cost: '8.25' }]);
    expect(rawCurrentPriceMap(rows)).toEqual({ a: 8.25 });
    expect(rows[0].price_source).toBe('fifo');
  });
  it('preserves an earlier known price when FIFO is absent, zero, or negative', () => {
    const rows = mergeRawFifoKnownPrices([known('a', 14), known('b', 6)], [
      { raw_material_id: 'a', branch_id: 'b', avg_cost: 0 },
      { raw_material_id: 'b', branch_id: 'b', avg_cost: -4 },
    ]);
    expect(rawCurrentPriceMap(rows)).toEqual({ a: 14, b: 6 });
  });
  it('leaves never-priced materials without a price, not zero', () => {
    const rows = mergeRawFifoKnownPrices([known('a', null)], [
      { raw_material_id: 'a', branch_id: 'b', avg_cost: null },
    ]);
    expect(rawCurrentPriceMap(rows)).toEqual({ a: null });
  });
  it('limits FIFO additions to requested raw materials', () => {
    const rows = mergeRawFifoKnownPrices([], [
      { raw_material_id: 'a', branch_id: 'b', avg_cost: 4 },
      { raw_material_id: 'outside', branch_id: 'b', avg_cost: 8 },
    ], ['a']);
    expect(rawCurrentPriceMap(rows)).toEqual({ a: 4 });
  });
});
