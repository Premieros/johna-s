import { describe, expect, it } from 'vitest';
import { REPORT_REGISTRY } from '@/features/reporting/reportRegistry';
import { FINANCIAL_REPORT_FAMILIES, OPERATIONAL_REPORT_FAMILIES, REPORT_FAMILIES, getVisibleReportFamilies } from '@/features/reporting/reportFamilies';

describe('core report families', () => {
  it('assigns every registered report to exactly one known family', () => {
    const keys = REPORT_FAMILIES.map(family => family.key);
    expect(new Set(keys).size).toBe(8);
    expect(Object.keys(OPERATIONAL_REPORT_FAMILIES).sort()).toEqual(REPORT_REGISTRY.map(report => report.key).sort());
    for (const family of Object.values(OPERATIONAL_REPORT_FAMILIES)) expect(keys).toContain(family);
    for (const family of Object.values(FINANCIAL_REPORT_FAMILIES)) expect(keys).toContain(family);
  });
  it('omits empty families from permission-filtered and searched results', () => {
    expect(getVisibleReportFamilies([], [])).toEqual([]);
    expect(getVisibleReportFamilies([{ key: 'expenses' }], []).map(family => family.key)).toEqual(['expenses']);
    expect(getVisibleReportFamilies([], [{ key: 'treasury_statement' }, { key: 'inventory_movement' }]).map(family => family.key)).toEqual(['inventory', 'payments']);
  });
  it('merges operational and financial treasury reports into one family', () => {
    expect(getVisibleReportFamilies([{ key: 'financial_reconciliation' }], [{ key: 'treasury_statement' }]).map(family => family.key)).toEqual(['payments']);
  });
});
