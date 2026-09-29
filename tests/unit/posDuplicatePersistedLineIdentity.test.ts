import { describe, expect, it } from 'vitest';
import { cartLineKey, orderItemsToCart } from '@/features/pos/utils/cart';
import { computeSentState } from '@/features/pos/utils/sentState';
import type { OrderItem, Product } from '@/lib/types';

const water = { id: 'water-product', name: 'Water', sale_price: 10 } as Product;

function row(id: string, quantity: number): OrderItem {
  return {
    id,
    order_id: 'order-1',
    product_id: water.id,
    unit_name: 'piece',
    quantity,
    unit_price: 10,
    discount_amount: 0,
    bonus_quantity: 0,
    total: quantity * 10,
    notes: null,
    modifier_option_ids: [],
    modifiers_snapshot: [],
    created_at: '2026-09-29T00:00:00.000Z',
  } as OrderItem;
}

describe('POS duplicate persisted line identity hotfix', () => {
  it('keeps identical persisted product rows independently addressable', () => {
    const rows = [row('water-4', 4), row('water-5', 5)];
    const cart = orderItemsToCart(rows, [water]);

    expect(cart).toHaveLength(2);
    expect(cart[0].order_item_id).toBe('water-4');
    expect(cart[1].order_item_id).toBe('water-5');
    expect(cartLineKey(cart[0])).toBe('order-item:water-4');
    expect(cartLineKey(cart[1])).toBe('order-item:water-5');
    expect(cartLineKey(cart[0])).not.toBe(cartLineKey(cart[1]));
  });

  it('keeps kitchen sent state isolated per duplicate persisted row', () => {
    const rows = [row('water-4', 4), row('water-5', 5)];
    const cart = orderItemsToCart(rows, [water]);
    const state = computeSentState(cart, rows, new Set(['water-4', 'water-5']), []);

    expect(state['order-item:water-4'].sentQty).toBe(4);
    expect(state['order-item:water-5'].sentQty).toBe(5);
    expect(state['order-item:water-4'].sent).toBe(true);
    expect(state['order-item:water-5'].sent).toBe(true);
  });
});
