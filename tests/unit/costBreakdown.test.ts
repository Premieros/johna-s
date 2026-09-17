import { describe, expect, it } from 'vitest';
import { calculateCostBreakdown, costingBreakdownMatches } from '../../src/lib/costBreakdown';

describe('cost breakdown explanation', () => {
  it('reconstructs a weighted average from multiple prices and quantities', () => {
    const result = calculateCostBreakdown([
      { quantity: 10, unit_cost: 20 },
      { quantity: 30, unit_cost: 30 },
    ]);
    expect(result.totalQuantity).toBe(40);
    expect(result.totalValue).toBe(1100);
    expect(result.weightedAverage).toBe(27.5);
  });

  it('keeps decimal quantities exact enough for recipe materials', () => {
    const result = calculateCostBreakdown([
      { quantity: 0.125, unit_cost: 80 },
      { quantity: 0.375, unit_cost: 100 },
    ]);
    expect(result.totalQuantity).toBe(0.5);
    expect(result.totalValue).toBe(47.5);
    expect(result.weightedAverage).toBe(95);
  });

  it('ignores non-positive or invalid source quantities in the explanatory average', () => {
    const result = calculateCostBreakdown([
      { quantity: 5, unit_cost: 12 },
      { quantity: 0, unit_cost: 999 },
      { quantity: -3, unit_cost: 999 },
      { quantity: Number.NaN, unit_cost: 999 },
    ]);
    expect(result.totalQuantity).toBe(5);
    expect(result.weightedAverage).toBe(12);
  });

  it('reports whether reconstructed and used costs reconcile within display tolerance', () => {
    expect(costingBreakdownMatches(27.5, 27.5)).toBe(true);
    expect(costingBreakdownMatches(27.5, 27.55)).toBe(true);
    expect(costingBreakdownMatches(27.5, 28)).toBe(false);
  });
});
