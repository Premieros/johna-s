import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const source = readFileSync(resolve(root, 'src/features/pos/components/tables/PosTablesSidebar.tsx'), 'utf8');

describe('POS tables responsive layout contract', () => {
  it('does not reserve a full viewport width beside the desktop order panel', () => {
    expect(source).not.toContain('min-w-[100vw]');
    expect(source).toContain('lg:w-[calc(100vw-380px)]');
    expect(source).toContain('xl:w-[calc(100vw-410px)]');
    expect(source).toContain('2xl:w-[calc(100vw-440px)]');
  });

  it('uses an adaptive table grid instead of fixed desktop column counts', () => {
    expect(source).toContain('data-testid="pos-table-grid"');
    expect(source).toContain('grid-cols-[repeat(auto-fit,minmax(150px,1fr))]');
    expect(source).not.toContain('lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10');
  });
});
