import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(process.cwd(), 'src/features/pos/utils/printing.ts'), 'utf8');

describe('customer receipt thermal fit', () => {
  it('uses a safe printable content width smaller than the paper roll', () => {
    expect(source).toContain('const safeContentWidthMm = Math.max(46, width - (compact ? 4 : 6));');
    expect(source).toContain('width: ${safeContentWidthMm}mm;');
    expect(source).toContain('margin: 0 auto;');
  });

  it('keeps the paper page at configured thermal width while fitting content inside it', () => {
    expect(source).toContain('width: ${width}mm;');
    expect(source).toContain('max-width: ${safeContentWidthMm}mm !important;');
  });
});
