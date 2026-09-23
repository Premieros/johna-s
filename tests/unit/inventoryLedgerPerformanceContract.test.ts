import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260923113000_inventory_ledger_search_pagination.sql',
  'utf8',
);
const page = readFileSync(
  'src/features/inventory/pages/InventoryLedgerPage.tsx',
  'utf8',
);

describe('Inventory Ledger performance/search contract', () => {
  it('uses permission-first keyset pagination with a hard 51-row cap', () => {
    expect(migration).toContain("public.can_permission('inventory.ledger.view')");
    expect(migration).toContain('public.user_may_access_branch');
    expect(migration).toContain('p_before_created_at');
    expect(migration).toContain('p_before_id');
    expect(migration).toContain('LEAST(GREATEST(COALESCE(p_limit,51),1),51)');
    expect(migration).not.toMatch(/COUNT\s*\(/i);
  });

  it('searches complete server-side ledger fields including item names', () => {
    expect(migration).toContain("COALESCE(il.reference_number,'') ILIKE");
    expect(migration).toContain("COALESCE(il.batch_number,'') ILIKE");
    expect(migration).toContain("COALESCE(p.name,'') ILIKE");
    expect(migration).toContain("COALESCE(rm.name,'') ILIKE");
    expect(migration).toContain("COALESCE(w.name,'') ILIKE");
  });

  it('loads 50 visible rows plus one lookahead and does not locally filter search results', () => {
    expect(page).toContain('const PAGE_SIZE = 50');
    expect(page).toContain("rpc<LedgerRpcRow[]>('search_inventory_ledger'");
    expect(page).toContain('p_limit: PAGE_SIZE + 1');
    expect(page).toContain('const page = fetched.slice(0, PAGE_SIZE)');
    expect(page).not.toContain('const filtered = rows.filter');
  });

  it('does not touch printing or kitchen behavior', () => {
    expect(migration).not.toContain('cloud_print_jobs');
    expect(migration).not.toContain('send_to_kitchen');
    expect(migration).not.toContain('printer');
  });
});
