import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const renderer = fs.readFileSync(path.join(process.cwd(), 'src/features/pos/services/localPrintAgent.ts'), 'utf8');

describe('customer receipt thermal fit', () => {
  it('keeps the approved customer form inside the fixed 80mm roll', () => {
    expect(renderer).toContain('@page { size: ${width}mm auto; margin: 0; }');
    expect(renderer).toContain('width: ${width}mm;');
    expect(renderer).toContain("padding: ${kitchen ? '3.4mm 4mm 3.2mm' : '4.8mm 5mm 4.2mm'};");
  });

  it('reserves fixed numeric columns and lets product names wrap before amounts can clip', () => {
    expect(renderer).toContain('grid-template-columns: 8mm minmax(0, 1fr) 19mm 23mm;');
    expect(renderer).toContain('overflow-wrap: anywhere');
    expect(renderer).toContain('white-space: nowrap');
    expect(renderer).toContain('font-variant-numeric: tabular-nums');
    expect(renderer).toContain('direction: ltr');
  });
});
