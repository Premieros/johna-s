import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20261004133000_raw_material_cogs_accounting.sql',
  'utf8',
);

describe('raw-material COGS accounting contract', () => {
  it('routes future sale-side finished-goods keys/codes to raw inventory', () => {
    expect(migration).toContain("p_reference_type IN ('sale','refund','fifo_cogs_reconcile')");
    expect(migration).toContain("v_account_key = 'inventory_fg'");
    expect(migration).toContain("v_account_key := 'inventory_rm'");
    expect(migration).toContain("= '1200'");
    expect(migration).toContain("v_account_code := '1210'");
  });

  it('uses raw-material inventory for new FIFO COGS reconciliation journals', () => {
    expect(migration.match(/semantic_key='inventory_rm'/g)?.length).toBeGreaterThanOrEqual(2);
    expect(migration).not.toContain("WHERE branch_id=v_sale.branch_id AND semantic_key='inventory_fg';");
    expect(migration).not.toContain("WHERE branch_id=p_branch_id AND semantic_key='inventory_fg';");
  });

  it('preserves the account of an existing historical FIFO reconcile journal', () => {
    expect(migration.match(/v_existing_inventory_account/g)?.length).toBeGreaterThanOrEqual(6);
    expect(migration).toContain("am.semantic_key IN ('inventory_rm','inventory_fg')");
    expect(migration).toContain("only newly-created journals switch to raw materials");
  });

  it('does not rewrite purchase or stock-count reference types', () => {
    expect(migration).not.toContain("p_reference_type IN ('purchase'");
    expect(migration).not.toContain("p_reference_type IN ('stock_count'");
  });

  it('does not backfill or mutate historical journal rows', () => {
    expect(migration).not.toMatch(/UPDATE\s+public\.journal_entry_lines\s+SET\s+account_id/i);
    expect(migration).not.toMatch(/DELETE\s+FROM\s+public\.journal_entry_lines/i);
  });
});
