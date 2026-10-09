import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('sales and station costing report display', () => {
  const report = readFileSync('src/features/reporting/pages/ReportsPage.tsx', 'utf8');
  it('shows available priced-component cost rather than an incomplete text placeholder', () => {
    expect(report.match(/line\.estimatedCost \?\? line\.knownEstimatedCost \?\? '—'/g)).toHaveLength(2);
    expect(report).not.toContain("line.estimatedCost ?? label('غير مكتملة', 'Incomplete')");
  });
  it('never derives recorded gross profit from estimated or partial pricing', () => {
    expect(report).toContain("line.cost === null ? label('غير متاح', 'Unavailable') : line.netBeforeTax - line.cost");
    expect(report).toContain("[label('خامات غير مسعرة', 'Unpriced Materials')]");
  });
});
