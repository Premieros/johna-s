import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const reports = readFileSync('src/features/reporting/pages/ReportsPage.tsx', 'utf8');
const excel = readFileSync('src/features/reporting/reportExcelProfiles.ts', 'utf8');

describe('raw material price terminology contract', () => {
  it('presents the costing-center authoritative raw cost as the canonical raw price', () => {
    expect(reports).toContain('سعر الخامة المعتمد (مركز التكلفة)');
    expect(reports).toContain('Canonical Raw Cost (Costing Center)');
    expect(reports).toContain('row.latest_authoritative_cost');
  });

  it('labels FIFO average as inventory valuation, not as the canonical raw price', () => {
    expect(reports).toContain('متوسط تكلفة المخزون المتبقي FIFO');
    expect(reports).toContain('Remaining Inventory FIFO Average Cost');
    expect(excel).toContain('متوسط تكلفة المخزون المتبقي FIFO');
    expect(excel).not.toContain("pick(lang, 'تكلفة الوحدة الحالية FIFO', 'Current FIFO Unit Cost')");
  });
});
