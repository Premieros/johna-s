import { describe, expect, it, vi } from 'vitest';
vi.mock('@/api', () => ({ supabase: {} }));
import { rawFifoCost, rawFifoCostMap } from '@/features/costing/services/rawFifoCostData';
describe('current actual FIFO inventory cost', () => {
  it('uses the persisted actual inventory cost and preserves its precision, including retained cost at negative stock', () => {
    expect(rawFifoCost({ raw_material_id: 'a', branch_id: 'b', avg_cost: '0.035' })).toBe(0.035);
    expect(rawFifoCostMap([{ raw_material_id: 'a', branch_id: 'b', avg_cost: 4 }])).toEqual({ a: 4 });
  });
  it('does not invent a manual/latest-price fallback for missing or inaccessible inventory', () => {
    for (const avg_cost of [0, null, 'NaN', '-2', 'Infinity']) expect(rawFifoCost({ raw_material_id: 'a', branch_id: 'b', avg_cost })).toBeNull();
    expect(rawFifoCost(undefined)).toBeNull();
  });
});
