import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
describe('sale-time ingredient cost report display', () => {
  const report = readFileSync('src/features/reporting/pages/ReportsPage.tsx', 'utf8');
  const projection = readFileSync('src/features/reporting/services/stationSalesReport.ts', 'utf8');
  it('shows known priced-component cost, never an invented zero or incomplete text', () => {
    expect(report.match(/line\.estimatedCost \?\? line\.knownEstimatedCost \?\? '—'/g)).toHaveLength(2);
    expect(report).not.toContain("line.estimatedCost ?? label('غير مكتملة', 'Incomplete')");
    expect(projection).toContain('costSource.pricedComponents > 0');
  });
  it('reports saved dispatch cost rather than repricing old sales or invoking FIFO', () => {
    expect(report).toContain('تكلفة المباع بسعر وقت الإرسال');
    expect(report).not.toContain('includeActualCost');
    expect(report).not.toContain('costMode:');
    expect(projection).not.toContain("supabase.from('inventory_ledger')");
    expect(projection).not.toContain('loadRawMaterialDisplayPrices');
    expect(report).toContain("[label('خامات غير مسعرة', 'Unpriced Materials')]");
  });
});
