import { describe, expect, it } from 'vitest';
import type { CartItem } from '@/lib/types';
import type { KitchenSendItem } from '@/features/pos/types';
import { confirmedSessionSendQuantity } from '@/features/pos/utils/orderSendState';
const item = { product: { id: 'water' }, quantity: 2, modifier_option_ids: [], item_note: '' } as unknown as CartItem;
const sent = { order_item_id: 'line-a', product_id: 'water', quantity: 2, notes: null, modifiers: [] } as unknown as KitchenSendItem;
describe('confirmed kitchen send before Realtime hydration', () => {
  it('allows the exact confirmed first send without waiting for another database read', () => {
    expect(confirmedSessionSendQuantity(item, [sent])).toBe(2);
  });
  it('does not cover a local increase after that send or an incremental delta', () => {
    expect(confirmedSessionSendQuantity({ ...item, quantity: 3 }, [sent])).toBeLessThan(3);
    expect(confirmedSessionSendQuantity(item, [{ ...sent, quantity: 1, current_quantity: 5 }])).toBe(1);
  });
  it('matches notes and modifier identities instead of product alone', () => {
    expect(confirmedSessionSendQuantity({ ...item, item_note: 'no ice' }, [sent])).toBe(0);
    expect(confirmedSessionSendQuantity({ ...item, modifier_option_ids: ['extra'] }, [sent])).toBe(0);
  });
  it('requires one exact saved line identity and the same product', () => {
    const saved = { ...item, order_item_id: 'line-b' };
    expect(confirmedSessionSendQuantity(saved, [sent])).toBe(0);
    expect(confirmedSessionSendQuantity(saved, [{ ...sent, order_item_id: 'line-b' }])).toBe(2);
    expect(confirmedSessionSendQuantity(saved, [{ ...sent, order_item_id: 'line-b', product_id: 'other' }])).toBe(0);
  });
  it('rejects ambiguous or malformed confirmations', () => {
    expect(confirmedSessionSendQuantity(item, [sent, { ...sent, order_item_id: 'line-b' }])).toBe(0);
    expect(confirmedSessionSendQuantity(item, [{ ...sent, quantity: Number.NaN }])).toBe(0);
    expect(confirmedSessionSendQuantity(item, [])).toBe(0);
  });
});
