import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260926124500_raw_negative_estimated_valuation.sql',
  'utf8',
);
const shift = readFileSync('src/features/trade/services/shiftClosingFinancials.ts', 'utf8');
const day = readFileSync('src/features/trade/services/dayClosingReport.ts', 'utf8');

describe('raw negative estimated valuation reporting contract', () => {
  it('keeps unresolved negative valuation separate from actual FIFO accounting', () => {
    expect(migration).toContain('actual_stock_value');
    expect(migration).toContain('estimated_negative_value');
    expect(migration).toContain('estimated_net_stock_value');
    expect(migration).toContain('oversold inventory-ledger rows remain zero-cost until a real receipt settles them');
  });

  it('uses canonical sale/kitchen-send raw ledger movements for shift/day consumption', () => {
    expect(migration).toContain("il.entry_type IN ('sale','kitchen_send')");
    expect(migration).toContain("COALESCE(il.reference_type, '') IN ('sale','kitchen_send')");
    expect(migration).toContain('private.financial_reference_visible');
    expect(migration).not.toContain("il.entry_type IN ('sale','production')");
  });

  it('prices unresolved consumption from a FIFO price known no later than the movement itself', () => {
    expect(migration).toContain('il2.created_at <= m.created_at');
    expect(migration).toContain('b.created_at <= m.created_at');
    expect(migration).toContain('estimated_unit_cost');
  });

  it('shows actual, estimated-negative and display totals in both closing reports', () => {
    expect(shift).toContain("getRawConsumptionCostBreakdown");
    expect(shift).toContain('actualCost: Number(row.actual_cost || 0)');
    expect(shift).toContain('estimatedCost: Number(row.estimated_cost || 0)');
    expect(day).toContain("getRawConsumptionCostBreakdown");
    expect(day).toContain('السالب التقديري');
    expect(day).toContain('displayedCost');
  });
});
