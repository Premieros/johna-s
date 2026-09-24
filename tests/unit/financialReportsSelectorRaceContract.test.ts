import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  'src/features/accounting/pages/FinancialReportsPage.tsx',
  'utf8',
);

describe('FinancialReports selector/branch race contract', () => {
  it('tracks the branch/view context that produced selector options', () => {
    expect(source).toContain('loadedSelectorContextKey');
    expect(source).toContain('selectorContextKey');
    expect(source).toContain("setLoadedSelectorContextKey('')");
    expect(source).toContain('setLoadedSelectorContextKey(selectorContextKey)');
  });

  it('cancels stale selector requests when branch/view/type changes', () => {
    expect(source).toContain('let cancelled = false');
    expect(source).toContain('if (cancelled) return');
    expect(source).toContain('return () => { cancelled = true; }');
  });

  it('does not run selector-dependent report RPCs with a stale branch selection', () => {
    expect(source).toContain("view === 'ledger'");
    expect(source).toContain("view === 'treasury_statement'");
    expect(source).toContain("view === 'inventory_movement'");
    expect(source).toContain("view === 'party_statement'");
    expect(source).toContain('loadedSelectorContextKey !== selectorContextKey');
  });

  it('normalizes stale account/item/warehouse selections against the newly loaded branch', () => {
    expect(source).toContain("rows.some((x) => x.id === prev) ? prev : (rows[0]?.id || '')");
    expect(source).toContain("itemRows.some((x) => x.id === prev) ? prev : (itemRows[0]?.id || '')");
    expect(source).toContain("warehouseRows.some((x) => x.id === prev) ? prev : ''");
  });
});
