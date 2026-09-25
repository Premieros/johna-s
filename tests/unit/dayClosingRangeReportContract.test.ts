import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260925155500_day_closing_range_report.sql'),
  'utf8',
);
const page = readFileSync(resolve(process.cwd(), 'src/features/reporting/pages/ReportsPage.tsx'), 'utf8');

describe('day closing range report contract', () => {
  it('reuses the authoritative day-closing report for every business day in the selected range', () => {
    expect(migration).toContain('generate_series');
    expect(migration).toContain('public.get_day_closing_report');
    expect(migration).toContain("'payment_methods'");
    expect(migration).toContain("'cash_after_outflows'");
  });

  it('keeps the report date driven and exposes the payment split', () => {
    expect(page).toContain("key: 'daily_closing_range'");
    expect(page).toContain("'حركة الأيام وطرق الدفع'");
    expect(page).toContain("'كاش'");
    expect(page).toContain("'كارت'");
    expect(page).toContain("'تحويل'");
    expect(page).toContain("'آجل'");
  });
});
