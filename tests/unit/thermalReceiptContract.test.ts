import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('thermal customer receipt contract', () => {
  const printing = read('src/features/pos/utils/printing.ts');
  const localAgent = read('src/features/pos/services/localPrintAgent.ts');

  it('keeps legacy 58/80 settings available while the approved fixed customer form stays 80mm', () => {
    expect(printing).toContain('THERMAL_RECEIPT_PRESET_WIDTHS_MM = [58, 80]');
    expect(printing).toContain('APPROVED_FIXED_THERMAL_WIDTH_MM = 80');
    expect(printing).toContain("const divider = '-'.repeat(isCompactThermalWidth(width) ? 32 : 42)");
  });

  it('renders the dedicated black-and-white RTL-safe fixed layout from the renderer', () => {
    expect(localAgent).toContain('<html lang="${ar ? \'ar\' : \'en\'}" dir="${dir}">');
    expect(localAgent).toContain('<meta charset="utf-8">');
    expect(localAgent).toContain('font-family: "Arial Narrow", "Segoe UI", Tahoma, Arial, sans-serif;');
    expect(localAgent).toContain('background: #fff;');
    expect(localAgent).toContain('color: #000;');
    expect(localAgent).toContain('@page { size: ${width}mm auto; margin: 0; }');
  });

  it('protects long item names and reserves non-wrapping LTR numeric columns', () => {
    expect(localAgent).toContain('overflow-wrap: anywhere');
    expect(localAgent).toContain('white-space: nowrap');
    expect(localAgent).toContain('direction: ltr;');
    expect(localAgent).toContain('unicode-bidi: isolate;');
    expect(localAgent).toContain('font-variant-numeric: tabular-nums;');
    expect(localAgent).toContain('grid-template-columns: 8mm minmax(0, 1fr) 19mm 23mm;');
  });

  it('sanitizes control characters before plain-text Print Agent fallback output', () => {
    expect(printing).toContain('function safeThermalText');
    expect(printing).toContain("ch === '\\r' || ch === '\\n' || ch === '\\t' || ch >= ' '");
  });

  it('does not weaken receipt Print Truth or browser fallback semantics', () => {
    const accepted = printing.indexOf('if (accepted) {');
    const record = printing.indexOf('await recordReceiptPrint(pending.authorization);', accepted);
    const fallback = printing.indexOf('browser fallback is not recorded as printed', accepted);

    expect(accepted).toBeGreaterThan(-1);
    expect(record).toBeGreaterThan(accepted);
    expect(fallback).toBeGreaterThan(record);
    expect(printing).toContain('if (!pending) return true;');
    expect(localAgent).toContain('return Boolean(result?.success)');
  });

  it('keeps kitchen ticket generation as a separate unchanged browser path', () => {
    expect(printing).toContain('export function buildKitchenTicketHtml');
    expect(printing).toContain('window.onload = function() { window.print();');
  });
});
