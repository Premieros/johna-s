import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/features/inventory/pages/WasteCenterPage.tsx', 'utf8');
const service = readFileSync('src/features/inventory/services/wasteCenterData.ts', 'utf8');

describe('ERP-05 waste center legacy-production contract', () => {
  it('keeps legacy production waste visible for historical review', () => {
    expect(source).toContain("{ value: 'production', ar: 'هالك إنتاج تاريخي', en: 'Legacy Production Waste' }");
    expect(source).toMatch(
      /<Select value=\{filterType\}[\s\S]*?\{WASTE_TYPES\.map\(wt => <option key=\{wt\.value\}/,
    );
  });

  it('does not offer legacy production waste for new operational entries', () => {
    expect(source).toContain(
      "const CREATABLE_WASTE_TYPES = WASTE_TYPES.filter((wt) => wt.value !== 'production');",
    );
    expect(source).toMatch(
      /label=\{ar \? 'نوع الهالك' : 'Waste Type'\}[\s\S]*?\{CREATABLE_WASTE_TYPES\.map\(wt => <option key=\{wt\.value\}/,
    );
  });

  it('rejects legacy production waste at the feature-service boundary too', () => {
    expect(service).toContain("if (params.wasteType === 'production')");
    expect(service).toContain("throw new Error('LEGACY_PRODUCTION_WASTE_READ_ONLY')");
  });

  it('keeps the entry-time cost display-only until approval-time FIFO costing is authoritative', () => {
    expect(source).toContain("label={ar ? 'تكلفة الوحدة التقديرية' : 'Estimated Unit Cost'}");
    expect(source).toContain('readOnly');
    expect(source).toContain('Final cost must come from the actual FIFO layers consumed when waste is approved.');
  });

  it('fails clearly when waste categories are unavailable', () => {
    expect(source).toContain('disabled={loading || categories.length === 0}');
    expect(source).toContain('No active waste categories are configured. Waste entry is disabled until category setup is completed.');
  });

  it('prefers authoritative approved cost in the waste table', () => {
    expect(source).toContain('r.approved_total_cost ?? r.total_cost ?? 0');
  });
});
