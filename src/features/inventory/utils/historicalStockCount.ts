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
  // Require an explicit offset; a browser-local date string is ambiguous across branches.
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(params.cutoff)) throw new Error('CUTOFF_TIMEZONE_REQUIRED');
  const cutoffTime = Date.parse(params.cutoff);
  if (!Number.isFinite(cutoffTime)) throw new Error('INVALID_CUTOFF');
  if (cutoffTime > Date.now()) throw new Error('FUTURE_CUTOFF_NOT_ALLOWED');
  const counted = finite(params.countedQuantity, 'COUNTED_QUANTITY');
  if (counted < 0) throw new Error('NEGATIVE_COUNTED_QUANTITY');
  const historical = finite(params.systemAtCutoff, 'SYSTEM_AT_CUTOFF');
  const current = finite(params.currentQuantity, 'CURRENT_QUANTITY');
  // Reconciliation is a consistency check, NOT proof of movement completeness:
  // omitted offsetting movements can still net to zero. The database must
  // separately certify full source coverage and transaction ordering.
  const seen = new Set<string>();
  let subsequent = 0;
  for (const movement of params.movementsAfterCutoff) {
    if (!movement.id || seen.has(movement.id)) throw new Error('DUPLICATE_OR_MISSING_MOVEMENT');
    seen.add(movement.id);
    if (!/(Z|[+-]\d{2}:\d{2})$/i.test(movement.occurredAt)) throw new Error('MOVEMENT_TIMEZONE_REQUIRED');
    const at = Date.parse(movement.occurredAt);
    if (!Number.isFinite(at) || at <= cutoffTime) throw new Error('MOVEMENT_NOT_AFTER_CUTOFF');
    subsequent += finite(movement.signedQuantity, 'MOVEMENT_QUANTITY');
  }
  finite(subsequent, 'MOVEMENT_TOTAL');
  const expected = finite(historical + subsequent, 'EXPECTED_CURRENT');
  // Fail closed when the supplied movement trail does not reconcile to live stock.
  if (Math.abs(expected - current) > 0.0001) throw new Error('INCOMPLETE_MOVEMENT_HISTORY');
  const variance = finite(counted - historical, 'VARIANCE');
  const projected = finite(current + variance, 'PROJECTED_CURRENT');
  return {
    systemAtCutoff: historical,
    varianceAtCutoff: variance,
    movementsAfterCutoff: subsequent,
    expectedCurrentBeforeAdjustment: expected,
    expectedCurrentAfterAdjustment: projected,
  };
}
