import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd());
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('mobile responsive UX system', () => {
  it('provides thumb navigation and a complete mobile control surface', () => {
    const layout = read('src/components/Layout.tsx');

    expect(layout).toContain('data-testid="mobile-bottom-nav"');
    expect(layout).toContain('grid-flow-col auto-cols-fr');
    expect(layout).toContain('data-testid="mobile-bottom-more"');
    expect(layout).toContain('data-testid="mobile-sidebar-controls"');
    expect(layout).toContain('data-testid="mobile-branch-select"');
    expect(layout).toContain('data-testid="mobile-language-toggle"');
    expect(layout).toContain('data-testid="mobile-theme-toggle"');
    expect(layout).toContain('data-testid="mobile-sign-out"');
    expect(layout).toContain('data-testid="app-content-shell"');
  });

  it('keeps the responsive system visual-only and independent from business rules', () => {
    const layout = read('src/components/Layout.tsx');
    const mobileCss = read('src/mobile-layer-fix.css');

    expect(layout).not.toContain('window.innerWidth');
    expect(layout).not.toContain('matchMedia(');
    expect(mobileCss).not.toMatch(/payment_method|branch_id\s*=|rpc\(/i);
  });

  it('respects safe areas and dynamic viewport sizing on phones', () => {
    const mobileCss = read('src/mobile-layer-fix.css');

    expect(mobileCss).toContain('env(safe-area-inset-top)');
    expect(mobileCss).toContain('env(safe-area-inset-bottom)');
    expect(mobileCss).toContain('100dvh');
    expect(mobileCss).toContain('@media (max-width: 359px)');
    expect(mobileCss).toContain('[data-testid="mobile-bottom-nav"]');
    expect(mobileCss).toContain('[data-testid="app-content-shell"]');
  });

  it('keeps shared buttons and form controls touch friendly below desktop', () => {
    const button = read('src/components/Button.tsx');
    const input = read('src/components/Input.tsx');

    expect(button).toContain('min-h-11 lg:min-h-0');
    expect(button).toContain('touch-manipulation');
    expect(input).toContain('min-h-11 lg:min-h-0');
  });

  it('uses bottom-sheet modal and filter behavior on phones', () => {
    const modal = read('src/components/Modal.tsx');
    const table = read('src/components/DataTable.tsx');
    const mobileCss = read('src/mobile-layer-fix.css');

    expect(modal).toContain('data-testid="modal-panel"');
    expect(modal).toContain('h-[min(92dvh,760px)]');
    expect(modal).toContain('data-testid="modal-header"');
    expect(table).toContain('data-testid="data-table-toolbar"');
    expect(table).toContain('data-testid="data-table-mobile-filters"');
    expect(table).toContain('data-testid="data-table-filter-menu"');
    expect(mobileCss).toContain('[data-testid="data-table-filter-menu"]');
    expect(mobileCss).toContain('position: fixed !important');
  });

  it('uses an explicit POS mobile dock and order sheet instead of the legacy hidden-panel checkout hack', () => {
    const mobileCss = read('src/mobile-layer-fix.css');
    const workspace = read('src/features/pos/pages/PosWorkspacePage.tsx');

    expect(workspace).toContain('data-testid="pos-mobile-command-dock"');
    expect(workspace).toContain('data-testid="pos-mobile-order-sheet"');
    expect(workspace).toContain('data-testid="pos-mobile-order-sheet-panel"');
    expect(workspace).toContain('data-testid="pos-mobile-nav-order"');
    expect(workspace).toContain('data-testid="pos-mobile-nav-orders"');
    expect(workspace).toContain('data-testid="pos-mobile-nav-tables"');
    expect(mobileCss).not.toContain('.hidden:has([data-testid="pos-payment-confirm"])');
    expect(mobileCss).toContain('[data-testid="pos-mobile-order-sheet-panel"]');
    expect(mobileCss).toContain('input[data-testid^="pos-split-payment-"]');
  });
});
