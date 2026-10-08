import { describe, expect, it } from 'vitest';
import { analysisColumns, REPORT_DATA_CONTRACTS } from '@/features/reporting/reportDataContracts';
import { analyseReportRows, emptyAnalysisLayout, normalizeAnalysisLayout } from '@/features/reporting/reportAnalysis';
import { comparisonPeriod } from '@/features/reporting/reportComparison';
import { REPORT_REGISTRY } from '@/features/reporting/reportRegistry';

describe('report contracts and analysis', () => {
  it('covers every registered source and row grain', () => {
    expect(Object.keys(REPORT_DATA_CONTRACTS).sort()).toEqual(REPORT_REGISTRY.map(report => report.key).sort());
    for (const contract of Object.values(REPORT_DATA_CONTRACTS)) { expect(contract.source).toBeTruthy(); expect(contract.grainAr).toBeTruthy(); expect(contract.grainEn).toBeTruthy(); }
  });
  it('filters the whole input, groups money, and refuses to sum rates, unit prices and mixed quantities', () => {
    const rows = [{ Branch: 'A', Product: 'one', 'Net Revenue': 10, 'Unit Cost': 3, 'Net Quantity': 1 }, { Branch: 'A', Product: 'two', 'Net Revenue': 20, 'Unit Cost': 3, 'Net Quantity': 1 }, { Branch: 'B', Product: 'three', 'Net Revenue': 50, 'Unit Cost': 8, 'Net Quantity': 2 }];
    const columns = analysisColumns('sales_by_product', rows);
    const layout = { ...emptyAnalysisLayout(), groups: ['Branch'] };
    const result = analyseReportRows(rows, columns, layout);
    expect(result[0]['Net Revenue']).toBe(30);
    expect(result[0]['Unit Cost']).toBeNull();
    expect(result[0]['Net Quantity']).toBeNull();
    const filtered = analyseReportRows(rows, columns, { ...layout, filters: { 'Net Revenue': { operator: 'min', value: '15' } } });
    expect(filtered[0]['Net Revenue']).toBe(20);
  });
  it('calculates weighted invoice average and keeps incomplete amounts unavailable', () => {
    const rows = [{ Branch: 'A', 'Net Sales': 100, Invoices: 1, 'Avg Invoice': 100 }, { Branch: 'A', 'Net Sales': 900, Invoices: 9, 'Avg Invoice': 100 }, { Branch: 'B', 'Net Sales': null, Invoices: 1, 'Avg Invoice': null }];
    const result = analyseReportRows(rows, analysisColumns('sales_by_employee', rows), { ...emptyAnalysisLayout(), groups: ['Branch'] });
    expect(result[0]['Avg Invoice']).toBe(100);
    expect(result[1]['Net Sales']).toBeNull();
    expect(result[1]['Avg Invoice']).toBeNull();
  });
  it('sorts numerically, leaves unavailable values last, and does not mutate source rows', () => {
    const rows = [{ Amount: 2 }, { Amount: null }, { Amount: 10 }];
    const result = analyseReportRows(rows, analysisColumns('expenses', rows), { ...emptyAnalysisLayout(), sort: { column: 'Amount', descending: true } });
    expect(result.map(row => row.Amount)).toEqual([10, 2, null]);
    expect(rows.map(row => row.Amount)).toEqual([2, null, 10]);
  });
  it('normalizes invalid saved values and bounds widths and grouping levels', () => {
    const layout = normalizeAnalysisLayout({ groups: ['a', 'a', 'b', 'c', 'd'], filters: { a: 42, b: { operator: 'contains', value: 5 } }, widths: { a: -1, b: 9000 }, pinned: null });
    expect(layout.groups).toEqual(['a', 'b', 'c']); expect(layout.filters).toEqual({}); expect(layout.widths).toEqual({ a: 80, b: 600 });
  });
  it('provides consistent core column identities across Arabic and English', () => {
    expect(analysisColumns('sales_by_product', [{ 'صافي الإيراد': 1, 'الفرع': 'A' }]).map(column => column.id)).toEqual(['Net Revenue', 'Branch']);
  });
  it('uses equal-length preceding periods and clamps leap-day year comparisons', () => {
    expect(comparisonPeriod({ from: '2026-10-01', to: '2026-10-08' }, 'previous')).toEqual({ from: '2026-09-23', to: '2026-09-30' });
    expect(comparisonPeriod({ from: '2024-02-29', to: '2024-02-29' }, 'year')).toEqual({ from: '2023-02-28', to: '2023-02-28' });
  });
  it('keeps all core sales money metrics additive and stable across Arabic and English', () => {
    const en=analysisColumns('sales',[{Subtotal:10,Discount:1,Tax:2,'Invoice Total':11,Paid:11,'Net Collection':9}]);
    const ar=analysisColumns('sales',[{'قبل الخصم والضريبة':10,'الخصم':1,'الضريبة':2,'إجمالي الفاتورة':11,'المدفوع':11,'صافي التحصيل':9}]);
    expect(ar.map(column=>column.id)).toEqual(en.map(column=>column.id));
    expect(en.every(column=>column.aggregation==='sum')).toBe(true);
  });

});
