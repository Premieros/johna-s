import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const sql = readFileSync('scripts/audit/critical-integrity.sql', 'utf8');

describe('critical integrity audit contract', () => {
  it('remains strictly read-only', () => {
    const withoutComments = sql
      .replace(/--.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');

    expect(withoutComments).not.toMatch(
      /\b(insert|update|delete|alter|drop|create|truncate|grant|revoke|call|do)\b/i,
    );
    expect(withoutComments.trimStart()).toMatch(/^WITH\b/i);
    expect(withoutComments).toMatch(/\bSELECT\s+jsonb_build_object\b/i);
  });

  it('covers the critical operational invariants', () => {
    for (const check of [
      'duplicate_open_shift_branches',
      'stale_empty_open_orders',
      'vacant_tables_with_effective_orders',
      'occupied_tables_without_effective_orders',
      'purchase_warehouse_branch_mismatch',
      'sale_warehouse_branch_mismatch',
      'order_warehouse_branch_mismatch',
      'raw_inventory_warehouse_branch_mismatch',
      'raw_batch_quantity_mismatch',
      'raw_fifo_unreconciled_rows',
      'unbalanced_journal_entries',
      'sale_payment_detail_mismatch',
      'sale_item_refund_integrity_violations',
      'live_kitchen_inventory_mismatch',
      'stale_active_print_jobs',
    ]) {
      expect(sql).toContain(`'${check}'`);
    }
  });

  it('only treats old empty order shells and old active print jobs as stale', () => {
    expect(sql).toContain("o.created_at < now()-interval '15 minutes'");
    expect(sql).toContain("created_at<now()-interval '10 minutes'");
  });
});
