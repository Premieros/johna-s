import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const printing = fs.readFileSync(path.join(process.cwd(), 'src/features/pos/utils/printing.ts'), 'utf8');
const renderer = fs.readFileSync(path.join(process.cwd(), 'src/features/pos/services/localPrintAgent.ts'), 'utf8');

describe('customer receipt thermal fit', () => {
  it('locks the approved customer form to 80mm with printable inner margins', () => {
    expect(printing).toContain('APPROVED_FIXED_THERMAL_WIDTH_MM = 80');
    expect(renderer).toContain('@page { size: ${width}mm auto; margin: 0; }');
    expect(renderer).toContain("padding: ${kitchen ? '3.4mm 4mm 3.2mm' : '4.8mm 5mm 4.2mm'};");
  });

  it('reserves numeric columns and lets item names wrap instead of clipping prices', () => {
    expect(renderer).toContain('grid-template-columns: 8mm minmax(0, 1fr) 19mm 23mm;');
    expect(renderer).toContain('white-space: nowrap;');
    expect(renderer).toContain('direction: ltr;');
    expect(renderer).toContain('font-variant-numeric: tabular-nums;');
    expect(renderer).toContain('.customer-item .item-name { font-weight: 800; overflow-wrap: anywhere;');
  });
});
