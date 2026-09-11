import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('purchase invoice edit and inline raw-material contract', () => {
  it('routes completed invoice corrections through the transactional backend rpc', () => {
    const api = read('src/api/domains/trade.ts');
    const page = read('src/features/trade/pages/PurchasesPage.tsx');
    const migration = read('supabase/migrations/20260911222000_update_purchase_invoice_transactional.sql');

    expect(api).toContain("rpc('update_purchase_invoice', p)");
    expect(page).toContain('api.trade.updatePurchase');
    expect(page).toContain("purchase.status !== 'completed'");
    expect(migration).toContain("v_purchase.status <> 'completed'");
    expect(migration).toContain("public.process_purchase_return(");
    expect(migration).toContain("public.process_purchase(");
    expect(migration).toContain('RAISE EXCEPTION USING');
  });

  it('keeps branch immutable and checks corrected warehouse ownership', () => {
    const page = read('src/features/trade/pages/PurchasesPage.tsx');
    const migration = read('supabase/migrations/20260911222000_update_purchase_invoice_transactional.sql');

    expect(page).toContain('disabled={!!editingPurchase}');
    expect(migration).toContain('user_may_access_branch(v_purchase.branch_id)');
    expect(migration).toContain('w.branch_id = v_purchase.branch_id');
    expect(migration).toContain("'WAREHOUSE_BRANCH_MISMATCH'");
  });

  it('keeps purchase authorization permission-first', () => {
    const page = read('src/features/trade/pages/PurchasesPage.tsx');
    const migration = read('supabase/migrations/20260911222000_update_purchase_invoice_transactional.sql');

    expect(page).toContain("const canReversePurchase = can('purchases.manage');");
    expect(migration).toContain("can_permission('purchases.manage')");
    expect(migration).not.toContain("v_role NOT IN");
    expect(migration).not.toContain("branch_manager");
  });

  it('creates raw materials inline only with the canonical create permission and required unit', () => {
    const page = read('src/features/trade/pages/PurchasesPage.tsx');

    expect(page).toContain("can('raw_materials.create')");
    expect(page).toContain("supabase.from('measurement_units')");
    expect(page).toContain("!rawForm.code.trim() || !rawForm.name.trim() || !rawForm.unit_id");
    expect(page).toContain("supabase.from('raw_materials').insert(payload).select('*').single()");
    expect(page).toContain("source: 'purchase_invoice'");
  });

  it('preserves the old corrected invoice as a returned audit revision', () => {
    const migration = read('supabase/migrations/20260911222000_update_purchase_invoice_transactional.sql');

    expect(migration).toContain("'-REV-'");
    expect(migration).toContain("'previous_purchase_id'");
    expect(migration).toContain("'previous_revision_number'");
    expect(migration).toContain("'transactional_reversal', true");
  });
});
