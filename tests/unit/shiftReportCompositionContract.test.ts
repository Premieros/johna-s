import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/features/trade/services/shiftClosingFinancials.ts', 'utf8');

describe('shift report product / ingredient composition contract', () => {
  it('enriches authoritative shift sales instead of returning empty composition sections', () => {
    expect(source).toContain("const saleIds = Array.from(new Set(salesDetails.map((sale) => sale.saleId).filter(Boolean)))");
    expect(source).toContain(".from('sale_items')");
    expect(source).toContain("product:products(name,name_en)");
    expect(source).toContain('refunded_quantity,refunded_amount');
    expect(source).toContain('const netQuantity = Math.max(0, Number(item.quantity || 0) - Number(item.refunded_quantity || 0))');
    expect(source).toContain('const netLineTotal = Math.max(0, grossLineTotal - Number(item.refunded_amount || 0))');
    expect(source).toContain('productsSold: Array.from(productMap');
    expect(source).toContain('ingredientsConsumed: Array.from(ingredientsMap');
    expect(source).toContain('orderTypes: Array.from(orderTypeMap');
    expect(source).not.toContain('productsSold: []');
    expect(source).not.toContain('ingredientsConsumed: []');
    expect(source).not.toContain('orderTypes: []');
  });

  it('keeps recipe expansion branch-scoped and does not alter shift membership authority', () => {
    expect(source).toContain(".from('recipes')");
    expect(source).toContain(".eq('branch_id', String(raw.branch_id))");
    expect(source).toContain("measurement_unit:measurement_units!raw_materials_unit_id_fkey(name,symbol,code)");
    expect(source).toContain("supabase.rpc('get_shift_closing_report', { p_shift_id: shiftId })");
    expect(source).not.toContain("sales.shift_id");
  });
});
