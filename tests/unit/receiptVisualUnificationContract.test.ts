import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('receipt visual unification contract', () => {
  const printing = readFileSync('src/features/pos/utils/printing.ts', 'utf8');
  const renderer = readFileSync('src/features/pos/services/localPrintAgent.ts', 'utf8');

  it('uses one shared fixed Arabic/English 80mm receipt renderer', () => {
    expect(printing).toContain('APPROVED_FIXED_THERMAL_WIDTH_MM = 80');
    expect(printing).toContain('const template = buildReceiptFixedTemplate');
    expect(printing).toContain('buildFixedThermalTemplateHtml(template)');
    expect(renderer).toContain('export function buildFixedThermalTemplateHtml');
    expect(renderer).toContain('font-family: "Arial Narrow"');
    expect(renderer).toContain('grid-template-columns: 8mm minmax(0, 1fr) 19mm 23mm;');
    expect(renderer).toContain('font-variant-numeric: tabular-nums;');
    expect(renderer).toContain('direction: ltr;');
    expect(renderer).not.toMatch(/isAr\s*\?\s*\d+\s*:\s*\d+/);
  });

  it('keeps existing print authority and routing primitives intact', () => {
    expect(printing).toContain("supabase.rpc('authorize_sale_print'");
    expect(printing).toContain("supabase.rpc('record_sale_print'");
    expect(printing).toContain('enqueueCloudReceiptPrint({');
    expect(printing).toContain('executeSilentPrint({');
    expect(printing).toContain('getLocalPrinterRoutes()');
  });
});
