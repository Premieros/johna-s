import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('sidebar direction contract', () => {
  it('positions sidebar from logical inline-start so RTL is right and LTR is left', () => {
    const layout = read('src/components/Layout.tsx');
    expect(layout).toContain('data-testid="app-sidebar"');
    expect(layout).toContain('fixed top-0 bottom-0 start-0');
    expect(layout).toContain('border-e');
    expect(layout).toContain("ar ? 'translate-x-full' : '-translate-x-full'");
  });

  it('sidebar spans the shell height while header remains independently fixed', () => {
    const layout = read('src/components/Layout.tsx');
    expect(layout).toContain('fixed top-0 bottom-0 start-0');
    expect(layout).toContain('data-testid="app-header"');
  });

  it('header is fixed and offsets from logical inline-start by sidebar width on desktop', () => {
    const layout = read('src/components/Layout.tsx');
    expect(layout).toContain('fixed top-0 start-0 end-0 lg:start-[260px]');
  });

  it('main content offsets from logical inline-start and fixed header', () => {
    const layout = read('src/components/Layout.tsx');
    expect(layout).toContain('pt-[64px] lg:ms-[260px]');
  });

  it('keeps the shared shell direction source on the Layout root', () => {
    const layout = read('src/components/Layout.tsx');
    expect(layout).toContain('<div dir={ar ? \'rtl\' : \'ltr\'}');
    expect(layout).toContain('data-testid="app-sidebar"');
    expect(layout).toContain('lg:translate-x-0');
  });
});
