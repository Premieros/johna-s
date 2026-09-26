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
    expect(source).toContain("costingApi.getRawConsumptionCostBreakdown");
    expect(source).toContain('ingredientsConsumed,');
    expect(source).toContain('orderTypes: Array.from(orderTypeMap');
    expect(source).not.toContain('productsSold: []');
    expect(source).not.toContain('ingredientsConsumed: []');
    expect(source).not.toContain('orderTypes: []');
  });

  it('uses FIFO ledger costing for raw consumption without altering shift membership authority', () => {
    expect(source).toContain("costingApi.getRawConsumptionCostBreakdown");
    expect(source).toContain('actualQuantity: Number(row.actual_quantity || 0)');
    expect(source).toContain('estimatedQuantity: Number(row.estimated_quantity || 0)');
    expect(source).toContain('actualCost: Number(row.actual_cost || 0)');
    expect(source).toContain('estimatedCost: Number(row.estimated_cost || 0)');
    expect(source).toContain('displayedCost: Number(row.displayed_cost || 0)');
    expect(source).not.toContain("raw_material:raw_materials(name,default_cost");
    expect(source).toContain("supabase.rpc('get_shift_closing_report', { p_shift_id: shiftId })");
    expect(source).not.toContain("sales.shift_id");
  });
});
