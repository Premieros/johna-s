import { describe, expect, it, vi } from 'vitest';
vi.mock('@/api', () => ({ supabase: {} }));
import { buildStationSalesLines, type StationSale, type StationSaleItem } from '@/features/reporting/services/stationSalesReport';
import { summarizeProductSales } from '@/features/reporting/services/productSalesReport';

const item = (id: string, amount: number): StationSaleItem => ({
  id, product_id: id, unit_name: 'piece', quantity: 1, unit_price: amount,
  discount_amount: 0, total: amount, refunded_quantity: 0, refunded_amount: 0,
  source_order_item_id: null, product: { name: 'Same name', category_id: 'category', category: null },
});
const sale = (items: StationSaleItem[]): StationSale => ({
  id: 'invoice', branch_id: 'branch', invoice_number: 'INV', created_at: '',
  subtotal: 300, total: 307.8, tax_amount: 37.8, refunded_amount: 0,
  status: 'completed', payment_method: 'split', order_type: 'dine_in',
  cashier: null, customer: null, items,
});

describe('canonical product sales', () => {
  it('retains the filtered product share rather than assigning it the whole invoice', () => {
    const invoice = sale([item('food', 100), item('drink', 200)]);
    const rows = summarizeProductSales(buildStationSalesLines([invoice], { product: 'drink' }, 'en'));
    expect(rows).toHaveLength(1);
    expect(rows[0].net).toBeCloseTo(205.2);
    expect(rows[0].discount).toBeCloseTo(20);
    expect(rows[0].netBeforeTax).toBeCloseTo(180);
  });
  it('keeps distinct product identities and sale units separate', () => {
    const invoice = sale([item('a', 100), item('b', 100), { ...item('a', 100), id: 'a-pack', unit_name: 'pack' }]);
    const rows = summarizeProductSales(buildStationSalesLines([invoice], {}, 'en'));
    expect(rows).toHaveLength(3);
    expect(rows.filter(row => row.productId === 'a')).toHaveLength(2);
    expect(rows.reduce((sum, row) => sum + row.net, 0)).toBeCloseTo(invoice.total);
  });
  it('reconciles partial returns and fractional quantities using invoice allocations', () => {
    const invoice = sale([{ ...item('a', 100), refunded_quantity: 0.5, refunded_amount: 50 }, item('b', 200)]);
    invoice.refunded_amount = 51.3;
    const rows = summarizeProductSales(buildStationSalesLines([invoice], {}, 'en'));
    expect(rows.reduce((sum, row) => sum + row.refunded, 0)).toBeCloseTo(51.3);
    expect(rows.reduce((sum, row) => sum + row.net, 0)).toBeCloseTo(256.5);
    expect(rows.find(row => row.productId === 'a')?.netQuantity).toBe(0.5);
  });
  it('partitions option combinations without duplicating allocated revenue or mixing sale units', () => {
    const snapshot = [{group_id:'size',group_name:'الحجم',option_id:'double',option_name:'دبل',price_delta:20}];
    const modified = {...item('a',120),id:'a-double',modifiers_snapshot:snapshot,bonus_quantity:1};
    const plain = {...item('a',100),id:'a-plain',modifiers_snapshot:[]};
    const invoice = sale([modified,plain]);
    const lines = buildStationSalesLines([invoice],{},'ar');
    const rows = summarizeProductSales(lines,true,'ar');
    expect(rows).toHaveLength(2);
    expect(rows.reduce((sum,row)=>sum+row.net,0)).toBeCloseTo(invoice.total);
    expect(rows.find(row=>row.options.includes('دبل'))).toMatchObject({bonusQuantity:1,invoiceCount:1});
    expect(summarizeProductSales(lines)).toHaveLength(1);
    expect(snapshot[0].option_name).toBe('دبل');
  });
  it('counts an invoice once per product group and rejects missing option metadata', () => {
    const lines=buildStationSalesLines([sale([item('a',100),{...item('a',100),id:'other-row'}])],{},'en');
    expect(summarizeProductSales(lines)[0].invoiceCount).toBe(1);
    expect(()=>summarizeProductSales(lines,true)).toThrow('SALES_OPTIONS_SOURCE_UNAVAILABLE');
  });

});
