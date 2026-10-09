import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20261004133000_raw_material_cogs_accounting.sql',
  'utf8',
);

describe('raw-material COGS accounting contract', () => {
  it('routes restaurant sale COGS to raw inventory only when no ready-product effect exists', () => {
    expect(migration).toContain("p_reference_type = 'sale'");
    expect(migration).toContain("e.target_type = 'product'");
    expect(migration).toContain("v_account_key = 'inventory_fg'");
    expect(migration).toContain("v_account_key := 'inventory_rm'");
    expect(migration).toContain("v_account_code := '1210'");
    expect(migration).toContain('AND NOT EXISTS');
  });

  it('keeps true ready-product sales eligible for finished-goods accounting', () => {
    expect(migration).toContain(
      'A sale that actually consumed product inventory keeps finished goods',
    );
    expect(migration).not.toContain(
      "p_reference_type IN ('sale','refund','fifo_cogs_reconcile')",
    );
  });

  it('makes refunds follow the exact inventory account used by the original sale', () => {
    expect(migration).toContain("p_reference_type = 'refund'");
    expect(migration).toContain("je.reference_type = 'sale'");
    expect(migration).toContain("je.reference_number = p_reference_number");
    expect(migration).toContain("a.code IN ('1200','1210')");
    expect(migration).toContain('v_original_inventory_code');
  });

  it('makes FIFO reconciliation follow the base sale and preserve an existing reconcile account', () => {
    expect(migration).toContain('Historical 1200 sales stay on 1200');
    expect(migration).toContain("je.reference_type='sale'");
    expect(migration).toContain("am.semantic_key IN ('inventory_rm','inventory_fg')");
    expect(migration.match(/v_existing_inventory_account/g)?.length).toBeGreaterThanOrEqual(6);
    expect(migration).toContain('never switch its account');
  });

  it('covers FIFO settlement that occurs before the base sale journal exists', () => {
    expect(migration).toContain('FIFO settlement can occur before the sale journal exists');
    expect(migration).toContain('IF v_inventory_account IS NULL THEN');
    expect(migration).toContain("e.target_type='product'");
    expect(migration).toContain("THEN 'inventory_fg'");
    expect(migration).toContain("ELSE 'inventory_rm'");
  });

  it('does not remap purchase or stock-count reference types', () => {
    expect(migration).not.toContain("p_reference_type = 'purchase'");
    expect(migration).not.toContain("p_reference_type = 'stock_count'");
  });

  it('does not backfill or move historical journal lines between accounts', () => {
    expect(migration).not.toMatch(/UPDATE\s+public\.journal_entry_lines\s+SET\s+account_id/i);
    expect(migration).not.toMatch(/DELETE\s+FROM\s+public\.journal_entry_lines/i);
  });
});
