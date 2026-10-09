import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const hook = readFileSync(resolve(process.cwd(), 'src/features/pos/hooks/usePosOrderBase.ts'), 'utf8');
const workspace = readFileSync(resolve(process.cwd(), 'src/features/pos/pages/PosWorkspacePage.tsx'), 'utf8');
const kitchen = readFileSync(resolve(process.cwd(), 'src/features/pos/services/kitchen.ts'), 'utf8');

describe('POS emergency negative-stock guard regression', () => {
  it('does not gate cart mutations or direct sale on stale UI stock snapshots', () => {
    const actions = hook.slice(hook.indexOf('  const addToCart ='), hook.indexOf('  const taxRate ='));
    expect(actions).not.toContain('insufficientStock');
    expect(actions).not.toContain('getStock(');
    const sale = hook.slice(hook.indexOf('  const completeSale ='), hook.indexOf('  const printReceipt ='));
    expect(sale).not.toContain('getStock(');
    expect(sale).not.toContain('insufficientStock');
  });

  it('keeps server-authoritative kitchen send and stock accounting', () => {
    expect(workspace).toContain('stockMap: EMPTY_POS_STOCK_MAP');
    expect(hook).toContain("await persistCart('open')");
    expect(hook).toContain('await sendOrderToKitchen(');
    expect(kitchen).toContain("'send_to_kitchen'");
  });

  it('preserves kitchen printing and station routing calls', () => {
    expect(hook).toContain('buildKitchenTicketHtml({');
    expect(hook).toContain('openPrintWindow(html, APPROVED_FIXED_THERMAL_WIDTH_MM)');
    expect(kitchen).toContain('dispatchKitchenStations({');
  });
});
