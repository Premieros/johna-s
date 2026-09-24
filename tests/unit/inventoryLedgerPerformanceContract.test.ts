import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260924075209_inventory_ledger_visibility_context_cache.sql',
  'utf8',
);
const page = readFileSync(
  'src/features/inventory/pages/InventoryLedgerPage.tsx',
  'utf8',
);

describe('Inventory Ledger performance/search contract', () => {
  it('keeps Permission-First checks while resolving caller context once', () => {
    expect(migration).toContain("public.can_permission('inventory.ledger.view')");
    expect(migration).toContain('public.user_may_access_branch(p_branch_id)');
    expect(migration).toContain('v_accessible_branch_ids');
    expect(migration).toContain("public.can_permission('history.unlimited')");
    expect(migration).toContain('private.get_financial_visibility_limits()');
    expect(migration).toContain('v_cutoff');

    // These calls caused the production timeout when evaluated for every
    // scanned ledger row. They must not return to the hot WHERE path.
    expect(migration).not.toContain('public.user_may_access_branch(il.branch_id)');
    expect(migration).not.toContain('private.financial_reference_visible(');
  });

  it('preserves exact referenced financial visibility without nested row helpers', () => {
    expect(migration).toContain('LEFT JOIN public.sales ref_sale');
    expect(migration).toContain('LEFT JOIN public.purchases ref_purchase');
    expect(migration).toContain('LEFT JOIN public.expenses ref_expense');
    expect(migration).toContain('LEFT JOIN public.customer_payments ref_customer_payment');
    expect(migration).toContain('LEFT JOIN public.supplier_payments ref_supplier_payment');
    expect(migration).toContain("md5(vis.vis_branch_id::text || ':' || vis.vis_row_id::text)");
    expect(migration).toContain('v_historical_percent');
    expect(migration).toContain('v_history_unlimited');
  });

  it('uses keyset pagination with a hard 51-row cap and no count scan', () => {
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
