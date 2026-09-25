import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260925153500_raw_material_financial_reports.sql'),
  'utf8',
);
const page = readFileSync(resolve(process.cwd(), 'src/features/reporting/pages/ReportsPage.tsx'), 'utf8');

describe('raw material financial reports contract', () => {
  it('keeps movement, current valuation and finance reports on authoritative inventory sources', () => {
    expect(migration).toContain('get_raw_material_consumption_report');
    expect(migration).toContain('get_current_raw_material_valuation');
    expect(migration).toContain('get_raw_material_financial_report');
    expect(migration).toContain('public.inventory_ledger');
    expect(migration).toContain('public.raw_material_batches');
    expect(migration).toContain("entry_type IN ('sale','kitchen_send')");
    expect(migration).toContain('private.financial_reference_visible');
  });

  it('does not aggregate incompatible raw-material quantities into one financial quantity total', () => {
    expect(migration).toContain('Quantity totals are intentionally kept per material');
    expect(migration).toContain("'rows',v_rows");
    expect(migration).toContain("'opening_inventory_value'");
    expect(migration).toContain("'closing_inventory_value'");
  });

  it('keeps quantity columns visible while refusing meaningless cross-unit quantity totals', () => {
    expect(page).toContain("[lang === 'ar' ? 'كمية أول المدة' : 'Opening Qty']: '—'");
    expect(page).toContain("[lang === 'ar' ? 'كمية المشتريات' : 'Purchase Qty']: '—'");
    expect(page).toContain("[lang === 'ar' ? 'كمية استهلاك المبيعات' : 'Sales Consumption Qty']: '—'");
    expect(page).toContain("[lang === 'ar' ? 'كمية آخر المدة' : 'Closing Qty']: '—'");
    expect(page).toContain("const exportData = isRawMaterialFinancial ? data.slice(1) : data");
    expect(page).toContain("isRawMaterialFinancial\n      ? data[0]");
  });

  it('exposes the three reports in the report page', () => {
    expect(page).toContain("key: 'raw_material_consumption'");
    expect(page).toContain("key: 'raw_material_current_cost'");
    expect(page).toContain("key: 'raw_material_financial'");
  });
});
