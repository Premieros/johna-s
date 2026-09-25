import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync('supabase/migrations/20260925204500_unified_reporting_sales_cost_contract.sql', 'utf8');

describe('operational net sales contract', () => {
  it('keeps collection net sales and costing net sales as separate helpers', () => {
    expect(migration).toContain('private.report_net_sale_amount');
    expect(migration).toContain('private.report_operational_net_sale_amount');
  });

  it('removes tax proportionally after refunds for Food Cost instead of subtracting the full original tax blindly', () => {
    expect(migration).toContain("COALESCE(p_total,0)-COALESCE(p_refunded_amount,0)");
    expect(migration).toContain("COALESCE(p_total,0)-COALESCE(p_tax_amount,0)");
    expect(migration).toContain('/ NULLIF(COALESCE(p_total,0),0)');
  });

  it('uses only the operational helper in costing summary and order margin', () => {
    const usages = migration.match(/private\.report_operational_net_sale_amount/g) || [];
    expect(usages.length).toBeGreaterThanOrEqual(3);
  });
});
