import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadExpenseCategoryOptions, loadReportFilterOptions } from '@/features/reporting/services/reportFilterOptions';
const state = vi.hoisted(() => ({ results: {} as Record<string, { data: unknown[] | null; error: unknown }>, tables: [] as string[] }));
vi.mock('@/api', () => ({ supabase: { from: (table: string) => {
  state.tables.push(table);
  return { select: () => ({ eq: () => Promise.resolve(state.results[table] || { data: [], error: null }) }) };
} } }));
const flags = { warehouse: true, cashier: false, customer: false, supplier: false, product: false, category: false, table: false };
beforeEach(() => { state.results = {}; state.tables = []; });
describe('report filter service failures', () => {
  it('propagates query failures rather than returning an empty successful options list', async () => {
    const error = { message: 'permission denied', code: '42501' };
    state.results.warehouses = { data: null, error };
    await expect(loadReportFilterOptions('branch', flags)).rejects.toBe(error);
    expect(state.tables).toEqual(['warehouses']);
  });
  it('does not run queries for disabled dimensions and preserves successful rows', async () => {
    state.results.warehouses = { data: [{ id: 'w', name: 'Warehouse' }], error: null };
    const result = await loadReportFilterOptions('branch', flags);
    expect(result.warehouses).toEqual([{ id: 'w', name: 'Warehouse' }]);
    expect(result.suppliers).toEqual([]);
    expect(state.tables).toEqual(['warehouses']);
  });
  it('propagates expense category failures and deduplicates valid categories', async () => {
    const error = { message: 'network failure' }; state.results.expenses = { data: null, error };
    await expect(loadExpenseCategoryOptions('branch')).rejects.toBe(error);
    state.results.expenses = { data: [{ category: 'Rent' }, { category: 'Rent' }, { category: '' }], error: null };
    await expect(loadExpenseCategoryOptions('branch')).resolves.toEqual(['Rent']);
  });
});
