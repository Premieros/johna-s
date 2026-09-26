import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20260918172500_costing_latest_raw_price_history.sql', 'utf8');
const page = fs.readFileSync('src/features/costing/pages/CostingCenterPage.tsx', 'utf8');
const api = fs.readFileSync('src/api/domains/costing.ts', 'utf8');

describe('costing latest raw-material price contract', () => {
  it('keeps inventory WAVG untouched and adds a costing-only latest-price resolver', () => {
    expect(migration).not.toContain('CREATE OR REPLACE FUNCTION public._raw_wavg_cost');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public._raw_cost_for_costing');
    expect(migration).toContain("il.entry_type = 'purchase'");
    expect(migration).toContain("sc.status = 'applied'");
    expect(migration).toContain('_normalize_raw_purchase_uom');
  });

  it('is permission-first and branch-scoped', () => {
    expect(migration).toContain("public.can_permission('reports.costing')");
    expect(migration).toContain('public.user_may_access_branch');
    expect(migration).not.toContain('public.is_pos_admin()');
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.get_raw_material_cost_overview(uuid) FROM PUBLIC, anon');
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.get_raw_material_cost_history(uuid, uuid, integer) FROM PUBLIC, anon');
  });

  it('surfaces latest price, source, date and history in the costing UI', () => {
    expect(page).toContain("type Tab = 'overview' | 'raw_prices' | 'orders' | 'supplier'");
    expect(page).toContain('getRawMaterialCostOverview');
    expect(page).toContain('getRawMaterialCostHistory');
    expect(page).toContain("isAr ? 'السعر المعروف / وحدة' : 'Known cost / unit'");
    expect(page).toContain("isAr ? 'القيمة الفعلية' : 'Actual value'");
    expect(page).toContain("isAr ? 'تكلفة السالب التقديرية' : 'Estimated negative cost'");
    expect(page).toContain("isAr ? 'مصدر السعر' : 'Price source'");
    expect(page).toContain("isAr ? 'تاريخ السعر' : 'Price date'");
    expect(api).toContain("rpc('get_raw_material_cost_valuation_overview', p)");
    expect(api).toContain("rpc('get_raw_material_cost_history', p)");
  });
});
