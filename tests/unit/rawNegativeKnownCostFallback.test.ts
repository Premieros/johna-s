import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260930203000_raw_negative_known_cost_fallback.sql',
  'utf8',
).replace(/\r\n/g, '\n');

describe('raw negative known-cost fallback contract', () => {
  it('keeps the resolver estimate-only and uses normalized known cost hierarchy', () => {
    expect(migration).toContain('last_fifo_issue');
    expect(migration).toContain('last_receipt_ledger');
    expect(migration).toContain("COALESCE(il.entry_type, '') = 'purchase'");
    expect(migration).toContain("COALESCE(il.reference_type, '') IN ('purchase', 'purchase_receipt')");
    expect(migration).toContain('last_real_batch');
    expect(migration).toContain('default_price');
    expect(migration).toContain('rm.default_cost');
  });

  it('does not rewrite actual ledger or journal cost', () => {
    expect(migration).not.toMatch(/UPDATE\s+public\.inventory_ledger/i);
    expect(migration).not.toMatch(/UPDATE\s+public\.journal_/i);
    expect(migration).not.toMatch(/UPDATE\s+public\.sales/i);
    expect(migration).not.toMatch(/UPDATE\s+public\.purchases/i);
  });

  it('backfills only unresolved zero-cost negative debt batches', () => {
    expect(migration).toContain('d.settled_quantity < d.debt_quantity');
    expect(migration).toContain('b.quantity < 0');
    expect(migration).toContain('COALESCE(b.unit_cost, 0) <= 0');
    expect(migration).toContain('COALESCE(k.estimated_cost, 0) > 0');
  });

  it('uses the shared known-cost resolver for unresolved consumption estimates', () => {
    expect(migration).toContain('public._raw_last_known_fifo_cost(');
    expect(migration).toContain('m.raw_material_id');
    expect(migration).toContain('m.branch_id');
    expect(migration).toContain('m.warehouse_id');
    expect(migration).toContain('p.consumed_qty * COALESCE(p.estimated_unit_cost, 0)');
  });
});
