import { describe, it, expect, vi } from 'vitest';
vi.mock('@/api', () => ({ supabase: {} }));
import { buildStationSalesLines, type StationSale, type StationSaleItem } from '@/features/reporting/services/stationSalesReport';
const item = (id: string, total: number, station: string): StationSaleItem => ({ id, product_id: id, unit_name: 'piece', quantity: 1, unit_price: total, discount_amount: 0, total, refunded_quantity: 0, refunded_amount: 0, source_order_item_id: id, product: { name: id, category_id: station, category: { name: station, kitchen_station_id: station, station: { id: station, name_ar: station, name_en: station } } } });
const sale = (items: StationSaleItem[]): StationSale => ({ id: 'sale', branch_id: 'branch', invoice_number: 'INV', created_at: '', subtotal: 300, total: 307.8, tax_amount: 37.8, refunded_amount: 0, status: 'completed', payment_method: 'split', order_type: 'dine_in', cashier: null, customer: null, items });
describe('station sales accounting', () => {
  it('allocates invoice discount and tax across both stations before filtering', () => {
    const s = sale([item('food', 100, 'kitchen'), item('drink', 200, 'barista')]);
    const all = buildStationSalesLines([s], {}, 'en');
    expect(all.reduce((sum, row) => sum + row.original, 0)).toBeCloseTo(307.8);
    expect(all.reduce((sum, row) => sum + row.tax, 0)).toBeCloseTo(37.8);
    expect(all.reduce((sum, row) => sum + row.discount, 0)).toBeCloseTo(30);
    const filtered = buildStationSalesLines([s], { station: 'barista' }, 'en');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].net).toBeCloseTo(205.2);
    expect(filtered[0].netBeforeTax).toBeCloseTo(180);
  });
  it('reconciles partial refund and fractional quantity without duplicating invoice refund', () => {
    const s = sale([item('food', 100, 'kitchen'), item('drink', 200, 'barista')]);
    s.refunded_amount = 51.3;
    s.items[0].refunded_amount = 50;
    s.items[0].refunded_quantity = 0.5;
    const rows = buildStationSalesLines([s], {}, 'ar');
    expect(rows.find(row => row.item.id === 'food')?.refunded).toBeCloseTo(51.3);
    expect(rows.find(row => row.item.id === 'drink')?.refunded).toBe(0);
    expect(rows.reduce((sum, row) => sum + row.net, 0)).toBeCloseTo(256.5);
    expect(rows.find(row => row.item.id === 'food')?.netQuantity).toBe(0.5);
  });
  it('uses exact kitchen FIFO snapshot and rejects ambiguous/missing item ownership', () => {
    const s = sale([item('food', 100, 'kitchen')]);
    const events = [{ id: 'event', settled_sale_id: 'sale', order_item_id: 'food', sent_quantity: 1, voided_quantity: 0, total_cost: 40, component_snapshot: [{ raw_material_id: 'raw', quantity: 2 }] }];
    const ledger = [{ reference_id: 'event', raw_material_id: 'raw', quantity: -2, total_cost: -40 }];
    expect(buildStationSalesLines([s], {}, 'en', events, { raw: 25 }, ledger)[0].cost).toBe(40);
    expect(buildStationSalesLines([s], {}, 'en')[0].cost).toBeNull();
    s.items.push({ ...s.items[0], id: 'duplicate' });
    expect(buildStationSalesLines([s], {}, 'en', events, { raw: 25 }, ledger).every(row => row.cost === null)).toBe(true);
  });
  it('retains unassigned and deleted catalog lines and filters product/category independently', () => {
    const s = sale([item('food', 100, 'kitchen'), { ...item('old', 200, 'barista'), product: null }]);
    expect(buildStationSalesLines([s], { station: 'unassigned' }, 'en')[0].item.id).toBe('old');
    expect(buildStationSalesLines([s], { category: 'kitchen', product: 'food' }, 'en')).toHaveLength(1);
  });
  it('keeps penny allocations equal to invoice total', () => {
    const s = sale([item('a', 1, 'x'), item('b', 1, 'y'), item('c', 1, 'z')]); s.total = 1; s.tax_amount = 0.01;
    const rows = buildStationSalesLines([s], {}, 'en');
    expect(rows.reduce((sum, row) => sum + row.original, 0)).toBe(1);
    expect(rows.reduce((sum, row) => sum + row.tax, 0)).toBe(0.01);
  });
  it('rejects partial FIFO including positive partially priced components and calculates latest estimates separately', () => {
    const s = sale([item('food', 275, 'kitchen')]);
    const events = [{ id: 'e', settled_sale_id: 'sale', order_item_id: 'food', sent_quantity: 1, voided_quantity: 0, total_cost: 37.8694,
      component_snapshot: [{ raw_material_id: 'chicken', raw_name: 'Chicken', quantity: 0.22 }, { raw_material_id: 'other', quantity: 1 }] }];
    const ledger = [{ reference_id: 'e', raw_material_id: 'chicken', quantity: -0.1, total_cost: -27 },
      { reference_id: 'e', raw_material_id: 'chicken', quantity: -0.12, total_cost: 0 },
      { reference_id: 'e', raw_material_id: 'other', quantity: -1, total_cost: -10.8694 }];
    const row = buildStationSalesLines([s], {}, 'en', events, { chicken: 270, other: 10.8694 }, ledger)[0];
    expect(row.cost).toBeNull();
    expect(row.estimatedCost).toBeCloseTo(70.2694);
    expect(row.unpricedMaterials).toEqual([]);
    const missing = buildStationSalesLines([s], {}, 'en', events, { other: 10.8694 }, ledger)[0];
    expect(missing.estimatedCost).toBeNull();
    expect(missing.knownEstimatedCost).toBeCloseTo(10.8694);
    expect(missing.unpricedMaterials).toEqual(['Chicken']);
    expect(buildStationSalesLines([s], {}, 'en', events, { chicken: 270, other: 10.8694 })[0].cost).toBeNull();
  });
  it('prorates latest estimates for voids and refunds using immutable snapshot quantities', () => {
    const s = sale([{ ...item('food', 275, 'kitchen'), quantity: 1, refunded_quantity: 0.5 }]);
    const events = [{ id: 'e', settled_sale_id: 'sale', order_item_id: 'food', sent_quantity: 2, voided_quantity: 1, total_cost: 80,
      component_snapshot: [{ raw_material_id: 'raw', quantity: 4 }] }];
    const ledger = [{ reference_id: 'e', raw_material_id: 'raw', quantity: -4, total_cost: -80 }];
    const row = buildStationSalesLines([s], {}, 'en', events, { raw: 30 }, ledger)[0];
    expect(row.cost).toBe(20);
    expect(row.estimatedCost).toBe(30);
  });

  it('keeps partially settled oversold FIFO unverified even if its ledger cost is positive', () => {
    const s = sale([item('food', 275, 'kitchen')]);
    const events = [{ id: 'e', settled_sale_id: 'sale', order_item_id: 'food', sent_quantity: 1, voided_quantity: 0, total_cost: 30,
      component_snapshot: [{ raw_material_id: 'raw', quantity: 5 }] }];
    const ledger = [{ reference_id: 'e', raw_material_id: 'raw', quantity: -5, total_cost: -30, batch_number: 'OV-debt' }];
    const row = buildStationSalesLines([s], {}, 'en', events, { raw: 10 }, ledger)[0];
    expect(row.cost).toBeNull();
    expect(row.estimatedCost).toBe(50);
  });

});
