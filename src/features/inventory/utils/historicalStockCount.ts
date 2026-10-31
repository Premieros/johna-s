/**
 * Pure quantity reconciliation for an audited physical-count cutoff.
 * Not a posting function: callers must establish complete historical movement
 * coverage and enforce FIFO/locking/accounting controls in the database.
 */
export type HistoricalCountMovement = {
  id: string;
  occurredAt: string;
  signedQuantity: number;
};

export type HistoricalCountReconciliation = {
  systemAtCutoff: number;
  varianceAtCutoff: number;
  movementsAfterCutoff: number;
  expectedCurrentBeforeAdjustment: number;
  expectedCurrentAfterAdjustment: number;
};

function finite(value: number, field: string): number {
  if (!Number.isFinite(value)) throw new Error(`INVALID_${field}`);
  return value;
}

export function reconcileHistoricalStockCount(params: {
  cutoff: string;
  countedQuantity: number;
  systemAtCutoff: number;
  currentQuantity: number;
  movementsAfterCutoff: readonly HistoricalCountMovement[];
}): HistoricalCountReconciliation {
  const cutoffTime = Date.parse(params.cutoff);
  if (!Number.isFinite(cutoffTime)) throw new Error('INVALID_CUTOFF');
  const counted = finite(params.countedQuantity, 'COUNTED_QUANTITY');
  if (counted < 0) throw new Error('NEGATIVE_COUNTED_QUANTITY');
  const historical = finite(params.systemAtCutoff, 'SYSTEM_AT_CUTOFF');
  const current = finite(params.currentQuantity, 'CURRENT_QUANTITY');
  const seen = new Set<string>();
  let subsequent = 0;
  for (const movement of params.movementsAfterCutoff) {
    if (!movement.id || seen.has(movement.id)) throw new Error('DUPLICATE_OR_MISSING_MOVEMENT');
    seen.add(movement.id);
    const at = Date.parse(movement.occurredAt);
    if (!Number.isFinite(at) || at <= cutoffTime) throw new Error('MOVEMENT_NOT_AFTER_CUTOFF');
    subsequent += finite(movement.signedQuantity, 'MOVEMENT_QUANTITY');
  }
  const expected = historical + subsequent;
  // Fail closed when the supplied movement trail does not reconcile to live stock.
  if (Math.abs(expected - current) > 0.0001) throw new Error('INCOMPLETE_MOVEMENT_HISTORY');
  const variance = counted - historical;
  return {
    systemAtCutoff: historical,
    varianceAtCutoff: variance,
    movementsAfterCutoff: subsequent,
    expectedCurrentBeforeAdjustment: expected,
    expectedCurrentAfterAdjustment: current + variance,
  };
}
