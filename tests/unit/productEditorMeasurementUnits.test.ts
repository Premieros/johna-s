import { describe, expect, it, vi } from 'vitest';
import { loadProductEditorData } from '@/features/catalog/services/productPageData';
const mocks = vi.hoisted(() => ({ from: vi.fn(), selected: [] as string[] }));
vi.mock('@/api', () => ({ supabase: { from: mocks.from } }));
describe('recipe editor measurement units', () => {
  it('reads the configured unit with branch-scoped material options without a separate per-material request', async () => {
    const filters: [string, unknown][] = [];
    mocks.from.mockImplementation(table => {
      const query = {
        select: (columns: string) => { if (table === 'raw_materials') mocks.selected.push(columns); return query; },
        eq: (column: string, value: unknown) => { if (table === 'raw_materials') filters.push([column, value]); return query; },
        order: () => query,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === 'raw_materials' ? [{ id: 'meat', name: 'Meat', branch_id: 'branch', unit: { name: 'Kilogram', symbol: 'kg' } }] : [], error: null }).then(resolve),
      };
      return query;
    });
    const result = await loadProductEditorData({ productId: 'product', branchId: 'branch' });
    expect(result.rawMaterials[0].unit?.symbol).toBe('kg');
    expect(mocks.selected).toEqual(['id,name,branch_id,unit:units(name,symbol)']);
    expect(filters).toEqual([['branch_id', 'branch'], ['is_active', true]]);
    expect(mocks.from.mock.calls.filter(([table]) => table === 'raw_materials')).toHaveLength(1);
    expect(mocks.from.mock.calls.some(([table]) => table === 'raw_material_batches')).toBe(false);
  });
});
