import { describe, expect, it, vi } from 'vitest';
vi.mock('@/api', () => ({ supabase: {} }));
import { buildStationSalesLines, type StationSale, type StationSaleItem, type CostEvent } from '@/features/reporting/services/stationSalesReport';

const item = (id: string, total: number, station: string): StationSaleItem => ({
  id, product_id: id, unit_name: 'piece', quantity: 1, unit_price: total,
  discount_amount: 0, total, refunded_quantity: 0, refunded_amount: 0,
  source_order_item_id: id,
  product: { name: id, category_id: station,
    category: { name: station, kitchen_station_id: station,
      station: { id: station, name_ar: station, name_en: station } } },
});
const sale = (items: StationSaleItem[]): StationSale => ({
  id: 'sale', branch_id: 'branch', invoice_number: 'INV', created_at: '',
  subtotal: 300, total: 307.8, tax_amount: 37.8, refunded_amount: 0,
  status: 'completed', payment_method: 'split', order_type: 'dine_in',
  cashier: null, customer: null, items,
});
const event = (components: CostEvent['component_snapshot'], sent = 1, voided = 0): CostEvent => ({
  id: 'event', settled_sale_id: 'sale', order_item_id: 'food',
  sent_quantity: sent, voided_quantity: voided, total_cost: 999,
  component_snapshot: components,
});
describe('sale-time operational ingredient costs (never FIFO ledger reads)', () => {
  it('allocates invoice discounts and tax before station filtering', () => {
    const s = sale([item('food', 100, 'kitchen'), item('drink', 200, 'barista')]);
    const all = buildStationSalesLines([s], {}, 'en');
    expect(all.reduce((sum, row) => sum + row.original, 0)).toBeCloseTo(307.8);
    expect(all.reduce((sum, row) => sum + row.tax, 0)).toBeCloseTo(37.8);
    expect(all.reduce((sum, row) => sum + row.discount, 0)).toBeCloseTo(30);
    const filtered = buildStationSalesLines([s], { station: 'barista' }, 'en');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].netBeforeTax).toBeCloseTo(180);
  });
  it('preserves partial refunds and fractional sold quantity', () => {
    const s = sale([item('food', 100, 'kitchen'), item('drink', 200, 'barista')]);
    s.refunded_amount = 51.3; s.items[0].refunded_amount = 50;
    s.items[0].refunded_quantity = 0.5;
    const rows = buildStationSalesLines([s], {}, 'ar');
    expect(rows.find(row => row.item.id === 'food')?.refunded).toBeCloseTo(51.3);
    expect(rows.find(row => row.item.id === 'drink')?.refunded).toBe(0);
    expect(rows.reduce((sum, row) => sum + row.net, 0)).toBeCloseTo(256.5);
    expect(rows.find(row => row.item.id === 'food')?.netQuantity).toBe(0.5);
  });
  it('prices from the immutable kitchen component snapshots, ignoring legacy FIFO total_cost', () => {
    const row = buildStationSalesLines([sale([item('food', 100, 'kitchen')])], {}, 'en', [
      event([{ raw_material_id: 'cheese', quantity: 0.2, unit_cost: 200, price_source: 'pricing' },
        { raw_material_id: 'bread', quantity: 1, unit_cost: 5, price_source: 'purchase' }]),
    ])[0];
    expect(row.estimatedCost).toBeCloseTo(45);
    expect(row.knownEstimatedCost).toBeCloseTo(45);
    expect(row.cost).toBeNull();
    expect(row.priceSnapshotStatus).toBe('complete');
  });
  it('shows priced component cost only, never prices a missing material at zero', () => {
    const row = buildStationSalesLines([sale([item('food', 100, 'kitchen')])], {}, 'en', [
      event([{ raw_material_id: 'cheese', raw_name: 'Cheese', quantity: 0.2, unit_cost: 200 },
        { raw_material_id: 'salt', raw_name: 'Salt', quantity: 0.01, unit_cost: null }]),
    ])[0];
    expect(row.estimatedCost).toBeNull();
    expect(row.knownEstimatedCost).toBeCloseTo(40);
    expect(row.unpricedMaterials).toEqual(['Salt']);
    expect(row.priceSnapshotStatus).toBe('partial');
  });
  it('leaves fully unpriced and old pre-snapshot sales unavailable', () => {
    const s = sale([item('food', 100, 'kitchen')]);
    const unknown = buildStationSalesLines([s], {}, 'en',
      [event([{ raw_material_id: 'a', quantity: 1, unit_cost: null }])])[0];
    expect(unknown.estimatedCost).toBeNull();
    expect(unknown.knownEstimatedCost).toBeNull();
    expect(unknown.priceSnapshotStatus).toBe('unpriced');
    const legacy = buildStationSalesLines([s], {}, 'en',
      [event([{ raw_material_id: 'a', quantity: 1 }])])[0];
    expect(legacy.knownEstimatedCost).toBeNull();
    expect(legacy.priceSnapshotStatus).toBe('legacy');
  });
  it('prorates saved sale-time costs for voids and refunds without repricing', () => {
    const s = sale([{ ...item('food', 100, 'kitchen'), refunded_quantity: 0.5 }]);
    const row = buildStationSalesLines([s], {}, 'en',
      [event([{ raw_material_id: 'flour', quantity: 4, unit_cost: 30 }], 2, 1)])[0];
    expect(row.estimatedCost).toBeCloseTo(30);
    expect(row.knownEstimatedCost).toBeCloseTo(30);
    expect(row.cost).toBeNull();
  });
  it('rejects ambiguous duplicate sale item ownership', () => {
    const s = sale([item('food', 100, 'kitchen')]);
    s.items.push({ ...s.items[0], id: 'duplicate' });
    const lines = buildStationSalesLines([s], {}, 'en',
      [event([{ raw_material_id: 'a', quantity: 1, unit_cost: 10 }])]);
    expect(lines.every(row => row.estimatedCost === null)).toBe(true);
  });
  it('distinguishes failed price lookups from an intentionally unpriced material', () => {
    const row = buildStationSalesLines([sale([item('food', 100, 'kitchen')])], {}, 'en',
      [event([{ raw_material_id: 'a', quantity: 1, unit_cost: null, price_source: 'lookup_failed' }])])[0];
    expect(row.priceSnapshotStatus).toBe('lookup_failed');
    expect(row.estimatedCost).toBeNull();
  });
  it('preserves unassigned and deleted catalog items and penny allocation', () => {
    const s = sale([item('food', 100, 'kitchen'), { ...item('old', 200, 'barista'), product: null }]);
    expect(buildStationSalesLines([s], { station: 'unassigned' }, 'en')[0].item.id).toBe('old');
    expect(buildStationSalesLines([s], { category: 'kitchen', product: 'food' }, 'en')).toHaveLength(1);
    const tiny = sale([item('a', 1, 'x'), item('b', 1, 'y'), item('c', 1, 'z')]);
    tiny.total = 1; tiny.tax_amount = 0.01;
    const rows = buildStationSalesLines([tiny], {}, 'en');
    expect(rows.reduce((sum, row) => sum + row.original, 0)).toBe(1);
    expect(rows.reduce((sum, row) => sum + row.tax, 0)).toBe(0.01);
  });
});
