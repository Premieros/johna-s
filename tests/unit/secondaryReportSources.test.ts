import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ dataset: vi.fn(), stock: vi.fn(), from: vi.fn() }));
vi.mock('@/api', () => ({ reporting: { getOperationalReportDataset: mocks.dataset, getOperationalStockSource: mocks.stock }, supabase: { from: mocks.from } }));
import { loadSalesByEmployeeRows, loadDetailedInvoiceRows, loadCashierPerformanceRows, loadReturnRows } from '@/features/reporting/services/reportSalesLoaders';
import { loadStationSalesLines } from '@/features/reporting/services/stationSalesReport';
import { loadInventoryBatchRows, loadLowStockSources, loadTopConsumedProductItems } from '@/features/reporting/services/reportInventoryLoaders';
const args = { branchId: 'A', from: '2026-10-01', to: '2026-10-07', fromTs: '2026-09-30T21:00:00Z', toExclusiveTs: '2026-10-07T21:00:00Z', filters: { cashier: 'operator', warehouse: 'warehouse' } };
const stock = { rawRows: [], unitRows: [], rawMasters: [], rawBalances: [], unitMasters: [], unitBatches: [] };
beforeEach(() => { vi.clearAllMocks(); mocks.dataset.mockResolvedValue({ data: { rows: [], summary: { count: 0, total: 0 } }, error: null }); mocks.stock.mockResolvedValue({ data: stock, error: null }); });
describe('secondary report canonical sources', () => {
  it('keeps cashier identities distinct when employee names match, without direct sales reads', async () => {
    const rows = ['first', 'second'].map(cashier_id => ({ cashier_id, cashier: { full_name: 'Same Name' }, total: 10 }));
    mocks.dataset.mockResolvedValue({ data: { rows, summary: { count: 2, total: 20 } }, error: null });
    for (const load of [loadSalesByEmployeeRows, loadCashierPerformanceRows]) {
      const result = await load(args);
      expect(result.map(row => row.cashier_id)).toEqual(['first', 'second']);
      expect(result[0].users).toEqual({ full_name: 'Same Name' });
      expect(mocks.dataset.mock.calls[mocks.dataset.mock.calls.length - 1]?.[0]).toMatchObject({ p_from_date: args.from, p_filters: args.filters });
    }
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('puts return and invoice dimensions into the canonical source before the bounded read', async () => {
    await loadReturnRows(args);
    expect(mocks.dataset.mock.calls[mocks.dataset.mock.calls.length - 1]?.[0].p_filters).toEqual({ ...args.filters, returns_only: 'true' });
    await loadDetailedInvoiceRows({ ...args, filters: { product: 'product', category: 'category' } });
    expect(mocks.dataset.mock.calls[mocks.dataset.mock.calls.length - 1]?.[0].p_filters).toEqual({ product: 'product', category: 'category' });
  });
  it('keeps complete invoice items for allocation and product ranking and omits cost reads', async () => {
    const item = { id: 'line', product_id: 'product', unit_name: 'piece', quantity: 3, refunded_quantity: 1, unit_price: 10, total: 30, refunded_amount: 10, source_order_item_id: null, product: { name: 'Product', category_id: null, category: null } };
    mocks.dataset.mockResolvedValue({ data: { rows: [{ id: 'invoice', branch_id: 'A', total: 27, tax_amount: 0, refunded_amount: 9, items: [item] }], summary: { count: 1, total: 18 } }, error: null });
    const lines = await loadStationSalesLines({ ...args, lang: 'en', includeCost: false });
    expect(lines[0]).toMatchObject({ net: 18, netQuantity: 2, discount: 3 });
    const products = await loadTopConsumedProductItems({ ...args, lang: 'en', includeCost: false });
    expect(products[0]).toMatchObject({ product_id: 'product', unit_name: 'piece', quantity: 3, refunded_quantity: 1 });
    expect(mocks.dataset.mock.calls[mocks.dataset.mock.calls.length - 1]?.[0].p_filters).toMatchObject({ include_items: 'true', settled_only: 'true' });
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('uses one stock RPC per projection with the warehouse context and shared failure handling', async () => {
    expect(await loadInventoryBatchRows({ branchId: 'A', warehouseId: 'warehouse' })).toEqual(stock);
    expect(mocks.stock.mock.calls[0][0]).toEqual({ p_branch_id: 'A', p_warehouse_id: 'warehouse', p_low_stock: false });
    await loadLowStockSources('A');
    expect(mocks.stock.mock.calls[1][0]).toEqual({ p_branch_id: 'A', p_warehouse_id: null, p_low_stock: true });
    mocks.stock.mockResolvedValueOnce({ data: null, error: { message: 'REPORT_SOURCE_LIMIT' } });
    await expect(loadLowStockSources('A')).rejects.toThrow('REPORT_SOURCE_LIMIT');
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
