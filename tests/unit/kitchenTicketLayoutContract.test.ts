import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('kitchen ticket print layout contract', () => {
  it('keeps quantity visually attached to each kitchen item', () => {
    const printing = read('src/features/pos/utils/printing.ts');
    expect(printing).toContain('class="qty-badge"');
    expect(printing).toContain('${escapeHtml(i.qty)}×');
    expect(printing).toContain("${isAr ? 'الكمية' : 'Qty'}: <strong>${escapeHtml(i.qty)}</strong>");
  });

  it('prints a visible ticket boundary and content-sized thermal page', () => {
    const printing = read('src/features/pos/utils/printing.ts');
    expect(printing).toContain('border: .45mm solid #000;');
    expect(printing).toContain('const pageHeightMm = Math.max(80');
    expect(printing).toContain('size: ${width}mm ${pageHeightMm}mm;');
    expect(printing).toContain('height: auto;');
  });
});
