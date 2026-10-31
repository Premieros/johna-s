import { describe, expect, it } from 'vitest';
import { reconcileHistoricalStockCount } from '../../src/features/inventory/utils/historicalStockCount';

const cutoff = '2026-10-31T20:00:00+02:00';

describe('historical stock count quantity reconciliation (pure, no posting)', () => {
  it('preserves subsequent sales rather than replacing current stock with the old count', () => {
    expect(reconcileHistoricalStockCount({
      cutoff, systemAtCutoff: 25, countedQuantity: 20, currentQuantity: 22,
      movementsAfterCutoff: [{ id: 'sale-1', occurredAt: '2026-11-01T10:00:00+02:00', signedQuantity: -3 }],
    })).toEqual({
      systemAtCutoff: 25, varianceAtCutoff: -5, movementsAfterCutoff: -3,
      expectedCurrentBeforeAdjustment: 22, expectedCurrentAfterAdjustment: 17,
    });
  });
  it('preserves subsequent purchases, even from negative starting stock', () => {
    const result = reconcileHistoricalStockCount({
      cutoff, systemAtCutoff: -7, countedQuantity: 2, currentQuantity: 5,
      movementsAfterCutoff: [{ id: 'receipt-1', occurredAt: '2026-11-01T10:00:00+02:00', signedQuantity: 12 }],
    });
    expect(result.varianceAtCutoff).toBe(9);
    expect(result.expectedCurrentAfterAdjustment).toBe(14);
  });
  it('rejects missing or duplicated movement history', () => {
    const params = { cutoff, systemAtCutoff: 25, countedQuantity: 20, currentQuantity: 22 };
    expect(() => reconcileHistoricalStockCount({ ...params, movementsAfterCutoff: [] })).toThrow('INCOMPLETE_MOVEMENT_HISTORY');
    expect(() => reconcileHistoricalStockCount({ ...params, currentQuantity: 19, movementsAfterCutoff: [
      { id: 'same', occurredAt: '2026-11-01T10:00:00+02:00', signedQuantity: -3 },
      { id: 'same', occurredAt: '2026-11-01T10:01:00+02:00', signedQuantity: -3 },
    ] })).toThrow('DUPLICATE_OR_MISSING_MOVEMENT');
  });
  it('rejects future physical count dates', () => {
    expect(() => reconcileHistoricalStockCount({
      cutoff: '2999-01-01T00:00:00Z', systemAtCutoff: 0,
      countedQuantity: 0, currentQuantity: 0, movementsAfterCutoff: [],
    })).toThrow('FUTURE_CUTOFF_NOT_ALLOWED');
  });
  it('rejects movements on/before cutoff and invalid amounts', () => {
    const params = { cutoff, systemAtCutoff: 1, countedQuantity: 1, currentQuantity: 1 };
    expect(() => reconcileHistoricalStockCount({ ...params, movementsAfterCutoff: [
      { id: 'a', occurredAt: cutoff, signedQuantity: 0 },
    ] })).toThrow('MOVEMENT_NOT_AFTER_CUTOFF');
    expect(() => reconcileHistoricalStockCount({ ...params, countedQuantity: -1, movementsAfterCutoff: [] })).toThrow('NEGATIVE_COUNTED_QUANTITY');
  });
  it('requires an explicit timezone for count and transaction timestamps', () => {
    const base = { cutoff, systemAtCutoff: 1, countedQuantity: 1, currentQuantity: 1, movementsAfterCutoff: [] };
    expect(() => reconcileHistoricalStockCount({ ...base, cutoff: '2026-10-31T20:00:00' })).toThrow('CUTOFF_TIMEZONE_REQUIRED');
    expect(() => reconcileHistoricalStockCount({ ...base, movementsAfterCutoff: [
      { id: 'sale', occurredAt: '2026-11-01T10:00:00', signedQuantity: 0 },
    ] })).toThrow('MOVEMENT_TIMEZONE_REQUIRED');
  });
  it('rejects overflow rather than returning an infinite projected inventory', () => {
    expect(() => reconcileHistoricalStockCount({
      cutoff, systemAtCutoff: -1e308, countedQuantity: 1e308,
      currentQuantity: -1e308, movementsAfterCutoff: [],
    })).toThrow('INVALID_EXPECTED_CURRENT');
  });

});
