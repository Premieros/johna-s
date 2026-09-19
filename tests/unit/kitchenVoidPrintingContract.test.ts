import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');

describe('kitchen void printing contract', () => {
  const orderBase = read('src/features/pos/hooks/usePosOrderBase.ts');
  const dispatch = read('src/features/pos/services/kitchenDispatch.ts');
  const cloud = read('src/features/pos/services/cloudPrint.ts');
  const localAgent = read('src/features/pos/services/localPrintAgent.ts');

  it('prints only after an authoritative sent-item void succeeds and keeps branch station routing', () => {
    const start = orderBase.indexOf('const voidSentItem = useCallback');
    const end = orderBase.indexOf('const persistCart', start);
    const block = orderBase.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(block).toContain("cancel_sent_order_item_exact");
    expect(block).toContain(".select('kitchen_station_id,branch_id')");
    expect(block).toContain(".from('kitchen_stations')");
    expect(block).toContain(".eq('branch_id', branchId)");
    expect(block).toContain("ticketType: 'void'");
    expect(block).toContain('kitchen-void:${orderItemId}:${remaining}');
    expect(block.indexOf("cancel_sent_order_item_exact")).toBeLessThan(
      block.indexOf('await dispatchKitchenStations'),
    );
  });

  it('keeps normal kitchen-send idempotency unchanged while isolating void tickets', () => {
    expect(cloud).toContain("safeText(params.idempotencyNamespace) || 'kitchen'");
    expect(cloud).toContain('${idempotencyNamespace}:${station}:${keySeed}');
    expect(dispatch).toContain('idempotencyNamespace: params.idempotencyNamespace');
  });

  it('clearly labels cancellation tickets for the destination station', () => {
    expect(localAgent).toContain("ctx.ticketType === 'void'");
    expect(localAgent).toContain("'*** إلغاء ***'");
    expect(localAgent).toContain("'سبب الإلغاء'");
  });
});
