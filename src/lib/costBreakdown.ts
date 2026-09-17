export interface CostBreakdownSource {
  quantity: number;
  unit_cost: number;
}

export interface CostBreakdownTotals {
  totalQuantity: number;
  totalValue: number;
  weightedAverage: number;
}

/**
 * Summarises the positive quantities that participate in an explanatory
 * weighted-average view. This helper is read-only: it never changes costing
 * or inventory state and is used only to make the existing cost transparent.
 */
export function calculateCostBreakdown(sources: CostBreakdownSource[]): CostBreakdownTotals {
  let totalQuantity = 0;
  let totalValue = 0;

  for (const source of sources) {
    const quantity = Number(source.quantity);
    const unitCost = Number(source.unit_cost);
    if (!Number.isFinite(quantity) || !Number.isFinite(unitCost) || quantity <= 0) continue;
    totalQuantity += quantity;
    totalValue += quantity * unitCost;
  }

  return {
    totalQuantity,
    totalValue,
    weightedAverage: totalQuantity > 0 ? totalValue / totalQuantity : 0,
  };
}

export function costingBreakdownMatches(usedCost: number, reconstructedCost: number): boolean {
  const used = Number(usedCost);
  const reconstructed = Number(reconstructedCost);
  if (!Number.isFinite(used) || !Number.isFinite(reconstructed)) return false;
  const tolerance = Math.max(0.01, Math.abs(used) * 0.005);
  return Math.abs(used - reconstructed) <= tolerance;
}
