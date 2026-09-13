import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const source = readFileSync(resolve(root, 'src/features/reporting/pages/ReportsPage.tsx'), 'utf8');

describe('ReportsPage compact tabular contract (PR6)', () => {
  it('keeps operational reports table-first without embedded Recharts visualizations', () => {
    expect(source).not.toContain("from 'recharts'");
    expect(source).not.toContain('<ResponsiveContainer');
    expect(source).not.toContain('<PieChart');
    expect(source).toContain('<table className="w-full text-sm">');
  });

  it('preserves filters, shared branch context and export/print actions', () => {
    expect(source).toContain('<ReportFilterBar');
    expect(source).toContain('showBranchFilter={false}');
    expect(source).toContain("branchFilterValue={branchFilter || ''}");
    expect(source).toContain('onBranchFilterChange={() => undefined}');
    expect(source).not.toContain('isAdminRole(user?.role)');
    expect(source).toContain('exportToExcelAdvanced');
    expect(source).toContain('downloadCSV');
    expect(source).toContain('openPrintWindow');
    expect(source).toContain("can('reports.export')");
    expect(source).toContain("can('reports.print')");
  });
});
