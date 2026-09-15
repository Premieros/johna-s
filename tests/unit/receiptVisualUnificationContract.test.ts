import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('receipt visual unification contract', () => {
  const source = readFileSync('src/features/pos/utils/printing.ts', 'utf8');

  it('uses one shared Arabic/English receipt typography profile', () => {
    expect(source).toContain('const bodyFontPx = compact ? 12 : 13;');
    expect(source).toContain('const itemFontPx = compact ? 12 : 13;');
    expect(source).toContain('const totalFontPx = compact ? 16 : 18;');
    expect(source).toContain('font-family: Arial, Tahoma, "Segoe UI", sans-serif;');
    expect(source).toContain('text-rendering: optimizeLegibility;');
    expect(source).not.toMatch(/isAr\s*\?\s*\d+\s*:\s*\d+/);
  });

  it('keeps existing print authority and routing primitives intact', () => {
    expect(source).toContain("supabase.rpc('authorize_sale_print'");
    expect(source).toContain("supabase.rpc('record_sale_print'");
    expect(source).toContain('enqueueCloudReceiptPrint({');
    expect(source).toContain('executeSilentPrint({');
    expect(source).toContain('getLocalPrinterRoutes()');
  });
});
