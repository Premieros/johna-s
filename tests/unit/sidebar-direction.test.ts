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

  it('header and main content release their logical offset when desktop sidebar is hidden', () => {
    const layout = read('src/components/Layout.tsx');
    expect(layout).toContain("desktopSidebarHidden ? 'lg:start-0' : 'lg:start-[260px]'");
    expect(layout).toContain("desktopSidebarHidden ? 'lg:ms-0' : 'lg:ms-[260px]'");
    expect(layout).toContain('data-testid="desktop-sidebar-toggle"');
    expect(layout).toContain('data-testid="desktop-sidebar-hide"');
    expect(layout).toContain("premier:desktop-sidebar-hidden");
  });

  it('keeps the shared shell direction source on the Layout root', () => {
    const layout = read('src/components/Layout.tsx');
    expect(layout).toContain('<div dir={ar ? \'rtl\' : \'ltr\'}');
    expect(layout).toContain('data-testid="app-sidebar"');
    expect(layout).toContain("desktopSidebarHidden ? (ar ? 'lg:translate-x-full' : 'lg:-translate-x-full') : 'lg:translate-x-0'");
  });
});
