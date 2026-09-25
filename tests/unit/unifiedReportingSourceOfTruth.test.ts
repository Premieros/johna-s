import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const migration = readFileSync(resolve(root, 'supabase/migrations/20260925204500_unified_reporting_sales_cost_contract.sql'), 'utf8');
const reportsCenter = readFileSync(resolve(root, 'src/features/reporting/pages/ReportsCenterPage.tsx'), 'utf8');
const shell = readFileSync(resolve(root, 'src/features/reporting/ReportingShell.tsx'), 'utf8');
const reportsPage = readFileSync(resolve(root, 'src/features/reporting/pages/ReportsPage.tsx'), 'utf8');
const routes = readFileSync(resolve(root, 'src/app/routes.tsx'), 'utf8');

describe('unified reporting source-of-truth contract', () => {
  it('separates collection net sales from pre-tax operational sales', () => {
    expect(migration).toContain('private.report_net_sale_amount');
    expect(migration).toContain('COALESCE(p_total,0)-COALESCE(p_refunded_amount,0)');
    expect(migration).toContain('private.report_operational_net_sale_amount');
    expect(migration).toContain('COALESCE(p_total,0)-COALESCE(p_tax_amount,0)');
  });

  it('forces costing summary and order margin through the same net-sales contract', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.get_costing_sales_summary');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.get_order_margin');
    expect(migration.match(/private\.report_operational_net_sale_amount/g)?.length || 0).toBeGreaterThanOrEqual(3);
  });

  it('keeps COGS resolution journal-first with settled kitchen and legacy sale fallbacks', () => {
    expect(migration).toContain("je.reference_type IN ('sale','fifo_cogs_reconcile')");
    expect(migration).toContain('order_kitchen_inventory_events');
    expect(migration).toContain("il.entry_type='sale'");
  });

  it('uses one unified reports center for operational and financial reports', () => {
    expect(reportsCenter).toContain('data-testid="unified-reports-center"');
    expect(reportsCenter).toContain('<FinancialReportsPage hideViewPicker />');
    expect(reportsCenter).toContain('<ReportsPage controlledReportType=');
    expect(routes).toContain('permission="reports.financial"><ReportsCenterPage');
  });

  it('keeps financial navigation inside the unified reports center', () => {
    expect(shell).toContain('/reports?section=financial&view=treasury_statement');
    expect(shell).toContain('/reports?section=financial&view=inventory_movement');
    expect(reportsPage).toContain('/reports?section=financial&view=${value}');
  });

  it('hides legacy duplicate manufacturing/component reports from discovery', () => {
    expect(shell).toContain('LEGACY_HIDDEN_REPORTS');
    expect(shell).toContain("'component_consumption'");
    expect(shell).toContain("'recipe_costs'");
    expect(shell).toContain("'top_consumed_components'");
    expect(shell).toContain("'top_consumed_products'");
  });
});
