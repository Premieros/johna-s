import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/features/inventory/pages/WasteCenterPage.tsx', 'utf8');

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
});
