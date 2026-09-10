import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('thermal customer receipt contract', () => {
  const printing = read('src/features/pos/utils/printing.ts');
  const localAgent = read('src/features/pos/services/localPrintAgent.ts');

  it('keeps 58mm and 80mm thermal paper as first-class presets without a schema change', () => {
    expect(printing).toContain('THERMAL_RECEIPT_PRESET_WIDTHS_MM = [58, 80]');
    expect(printing).toContain('s.receipt_width_mm || 80');
    expect(printing).toContain("const divider = '-'.repeat(isCompactThermalWidth(width) ? 32 : 42)");
  });

  it('renders a dedicated black-and-white RTL-safe print layout', () => {
    expect(printing).toContain('<html lang="${isAr ? \'ar\' : \'en\'}" dir="${isAr ? \'rtl\' : \'ltr\'}">');
    expect(printing).toContain('<meta charset="utf-8" />');
    expect(printing).toContain('font-family: Tahoma, Arial, "Segoe UI", sans-serif');
    expect(printing).toContain('background: #fff');
    expect(printing).toContain('color: #000');
    expect(printing).toContain('@media print');
    expect(printing).toContain('@page');
    expect(printing).toContain('width: ${width}mm !important');
  });

  it('protects long item names and thermal page breaks', () => {
    expect(printing).toContain('overflow-wrap: anywhere');
    expect(printing).toContain('break-inside: avoid');
    expect(printing).toContain('page-break-inside: avoid');
    expect(printing).toContain('white-space: nowrap');
    expect(printing).toContain('font-variant-numeric: tabular-nums');
  });

  it('sanitizes control characters before plain-text Print Agent output', () => {
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

  it('keeps kitchen ticket generation as a separate unchanged path', () => {
    expect(printing).toContain('export function buildKitchenTicketHtml');
    expect(printing).toContain('window.onload = function() { window.print();');
  });
});
