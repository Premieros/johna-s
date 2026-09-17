import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const header = fs.readFileSync(
  path.join(root, 'src/features/pos/components/order/PosOrderHeaderBar.tsx'),
  'utf8',
);
const orderHook = fs.readFileSync(
  path.join(root, 'src/features/pos/hooks/usePosOrderBase.ts'),
  'utf8',
);
const kitchenService = fs.readFileSync(
  path.join(root, 'src/features/pos/services/kitchen.ts'),
  'utf8',
);

describe('POS kitchen-send click reliability contract', () => {
  it('does not accept another kitchen click while the order is being saved or already sent', () => {
    expect(header).toContain('const kitchenActionBusy = kitchenSending || completing;');
    expect(header).toContain('disabled={kitchenActionBusy}');
    expect(header).toContain('aria-busy={kitchenActionBusy}');
    expect(header).toContain("'جارٍ حفظ الطلب...'");
    expect(header).not.toContain('disabled={kitchenSending}');
  });

  it('keeps the hook guard against transient order/loading/send races', () => {
    expect(orderHook).toContain(
      'if (cart.length === 0 || completing || orderLoading || kitchenSending) return false;',
    );
    expect(orderHook).toContain('setKitchenSending(true);');
    expect(orderHook).toContain('setKitchenSending(false);');
  });

  it('keeps the authoritative kitchen service single-flight per order', () => {
    expect(kitchenService).toContain('const activeSendLocks = new Set<string>();');
    expect(kitchenService).toContain("error: 'SEND_IN_PROGRESS'");
    expect(kitchenService).toContain('activeSendLocks.add(orderId);');
    expect(kitchenService).toContain('activeSendLocks.delete(orderId);');
  });
});
