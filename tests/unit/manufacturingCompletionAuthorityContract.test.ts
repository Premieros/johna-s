import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/api/domains/manufacturing.ts', 'utf8');
const completeStart = source.indexOf('async completeOrder');
const cancelStart = source.indexOf('async cancelOrder');
const completeBlock = source.slice(completeStart, cancelStart);

describe('manufacturing completion authority contract', () => {
  it('keeps complete_production_order as the only completion mutation authority', () => {
    expect(completeStart).toBeGreaterThanOrEqual(0);
    expect(cancelStart).toBeGreaterThan(completeStart);
    expect(completeBlock).toContain("rpc<RpcResult>('complete_production_order', p)");
  });

  it('fails closed instead of mutating stock tables from the browser fallback', () => {
    expect(completeBlock).not.toContain("from('raw_material_inventory')");
    expect(completeBlock).not.toContain("from('raw_material_movements')");
    expect(completeBlock).not.toContain("from('production_waste')");
    expect(completeBlock).not.toContain("from('inventory')");
    expect(completeBlock).not.toContain("from('production_orders')");
  });
});
