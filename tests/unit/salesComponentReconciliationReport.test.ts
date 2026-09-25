import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260925202000_sales_component_reconciliation_report.sql'),
  'utf8',
);

describe('sales component reconciliation report contract', () => {
  it('uses sold quantities and the canonical component resolver for theoretical consumption', () => {
    expect(migration).toContain('resolve_product_raw_components');
    expect(migration).toContain('quantity_per_sale*vi.sold_qty');
    expect(migration).toContain('refunded_quantity');
  });

  it('uses authoritative ledger rows tied to the same direct sales and settled kitchen sales', () => {
    expect(migration).toContain("il.entry_type='sale'");
    expect(migration).toContain("il.entry_type='kitchen_send'");
    expect(migration).toContain('e.settled_sale_id');
    expect(migration).toContain('public.inventory_ledger');
  });

  it('surfaces unmatched and componentless sale items instead of hiding them', () => {
    expect(migration).toContain("'unmatched_sale_rows'");
    expect(migration).toContain("'componentless_products'");
    expect(migration).toContain("'mismatched_raws'");
  });

  it('is a read-only reporting RPC with branch and permission gates', () => {
    expect(migration).toContain("can_permission('reports.costing')");
    expect(migration).toContain('user_may_access_branch');
    expect(migration).toContain('LANGUAGE plpgsql');
    expect(migration).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(migration).not.toMatch(/\bUPDATE\s+public\./i);
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/i);
  });
});
