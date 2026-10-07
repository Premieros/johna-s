import { describe, expect, it, vi } from 'vitest';
vi.mock('@/api', () => ({ supabase: {} }));
import { rawCurrentPrice, rawCurrentPriceMap } from '@/features/costing/services/rawCurrentPriceData';
import { convertPurchaseUnitPrice } from '@/features/trade/services/purchasePriceUnits';
const row = (cost: number | string | null) => ({ raw_material_id: 'raw', branch_id: 'branch', unit_cost: cost, price_source: 'stock_count', priced_at: null, reference_number: null });
describe('latest known price and purchase unit scaling', () => {
  it('preserves precise positive prices independently of depleted inventory', () => {
    expect(rawCurrentPrice(row('0.035'))).toBe(0.035);
    expect(rawCurrentPriceMap([row(270)])).toEqual({ raw: 270 });
  });
  it('keeps missing and invalid prices unavailable', () => {
    for (const value of [0, -1, null, 'NaN', 'Infinity']) expect(rawCurrentPrice(row(value))).toBeNull();
    expect(rawCurrentPrice(undefined)).toBeNull();
  });
  it('scales last price and manually entered price when changing kg/g or liter/ml', () => {
    expect(convertPurchaseUnitPrice(270, 'kg', 'جم')).toBe(0.27);
    expect(convertPurchaseUnitPrice(0.27, 'جم', 'kg')).toBe(270);
    expect(convertPurchaseUnitPrice(50, 'liter', 'مل')).toBe(0.05);
    expect(convertPurchaseUnitPrice(20, 'piece', 'kg')).toBeNull();
  });
});
