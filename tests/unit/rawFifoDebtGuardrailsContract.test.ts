import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20261003084500_raw_fifo_debt_health_guardrails.sql',
  'utf8',
).replace(/\r\n/g, '\n');

const page = readFileSync(
  'src/features/reporting/pages/ReportsPage.tsx',
  'utf8',
);

const excel = readFileSync(
  'src/features/reporting/reportExcelProfiles.ts',
  'utf8',
);

describe('raw FIFO debt health guardrails contract', () => {
  it('keeps the existing valuation RPC signature and branch/permission guards', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.get_current_raw_material_valuation(');
    expect(migration).toContain('p_branch_id uuid');
    expect(migration).toContain("public.can_permission('reports.costing')");
    expect(migration).toContain("public.can_permission('reports.financial')");
    expect(migration).toContain('public.user_may_access_branch(p_branch_id)');
  });

  it('derives debt health from canonical FIFO debt and purchase-receipt history', () => {
    expect(migration).toContain('public.raw_fifo_debts');
    expect(migration).toContain('GREATEST(d.debt_quantity-COALESCE(d.settled_quantity,0),0)');
    expect(migration).toContain('public._raw_last_known_fifo_cost(');
    expect(migration).toContain("COALESCE(il.entry_type,'') IN ('purchase','purchase_receipt')");
    expect(migration).toContain("'outstanding_fifo_debt_quantity'");
    expect(migration).toContain("'unpriced_fifo_debt_quantity'");
    expect(migration).toContain("'fifo_debt_pricing_coverage_pct'");
    expect(migration).toContain("'last_purchase_receipt_at'");
  });

  it('uses deterministic factual statuses without a hard quantity threshold', () => {
    expect(migration).toContain("'UNPRICED_NO_RECEIPT'");
    expect(migration).toContain("'UNPRICED'");
    expect(migration).toContain("'NO_RECEIPT_HISTORY'");
    expect(migration).toContain("'OUTSTANDING'");
    expect(migration).toContain("'OK'");
    expect(migration).not.toMatch(/MAX_DEBT|DEBT_LIMIT|BLOCK_SALE|RAISE EXCEPTION 'RAW_DEBT/i);
  });

  it('is report-only and never rewrites stock, debt, ledger or journal data', () => {
    expect(migration).not.toMatch(/UPDATE\s+public\./i);
    expect(migration).not.toMatch(/INSERT\s+INTO\s+public\./i);
    expect(migration).not.toMatch(/DELETE\s+FROM\s+public\./i);
    expect(migration).not.toContain('_raw_remove_fifo(');
    expect(migration).not.toContain('_raw_add(');
  });

  it('surfaces debt health on-screen and in the Excel profile', () => {
    for (const label of [
      'Outstanding FIFO Debt',
      'FIFO Debt Rows',
      'Estimated Debt Value',
      'Unpriced Debt Qty',
      'Debt Pricing Coverage %',
      'Oldest Debt',
      'Last Purchase Receipt',
      'Debt Status',
    ]) {
      expect(page).toContain(label);
      expect(excel).toContain(label);
    }
  });
});
