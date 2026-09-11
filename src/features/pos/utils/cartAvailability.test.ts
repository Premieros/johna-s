import { describe, expect, it } from 'vitest';
import type { CartItem, OrderItem, Product } from '@/lib/types';
import type { OrderKitchenSend } from '../types';
import { computeUnsentCartDemand } from './cartAvailability';

const product = (id: string): Product => ({ id, name: id, sale_price: 10 } as Product);
const cartItem = (id: string, quantity: number, note?: string): CartItem => ({
  product: product(id),
  unit_name: 'piece',
  quantity,
  unit_price: 10,
  discount_amount: 0,
  bonus_quantity: 0,
  modifier_option_ids: [],
  modifiers: [],
  item_note: note,
});

describe('computeUnsentCartDemand', () => {
  it('treats a new cart as fully unsent and aggregates lines by product', () => {
    expect(computeUnsentCartDemand([
      cartItem('p1', 1, 'a'),
      cartItem('p1', 2, 'b'),
      cartItem('p2', 3),
    ])).toEqual([
      { product_id: 'p1', quantity: 3 },
      { product_id: 'p2', quantity: 3 },
    ]);
  });

  it('subtracts cumulative sent quantity exactly once', () => {
    const cart = [cartItem('p1', 3)];
    const orderItems = [{ id: 'oi1', product_id: 'p1', quantity: 3, unit_name: 'piece', unit_price: 10, discount_amount: 0, bonus_quantity: 0, modifier_option_ids: [], modifiers: [], item_note: undefined } as unknown as OrderItem];
    const sends = [
      { order_item_id: 'oi1', sent_quantity: 2 } as OrderKitchenSend,
      // A duplicate/stale cumulative snapshot must not be summed with the first.
      { order_item_id: 'oi1', sent_quantity: 2 } as OrderKitchenSend,
    ];
    expect(computeUnsentCartDemand(cart, orderItems, sends)).toEqual([{ product_id: 'p1', quantity: 1 }]);
  });

  it('projects only the post-send delta and releases demand when removed', () => {
    const orderItems = [{ id: 'oi1', product_id: 'p1', quantity: 1, unit_name: 'piece', unit_price: 10, discount_amount: 0, bonus_quantity: 0, modifier_option_ids: [], modifiers: [], item_note: undefined } as unknown as OrderItem];
    const sends = [{ order_item_id: 'oi1', sent_quantity: 1 } as OrderKitchenSend];
    expect(computeUnsentCartDemand([cartItem('p1', 2)], orderItems, sends)).toEqual([{ product_id: 'p1', quantity: 1 }]);
    expect(computeUnsentCartDemand([], orderItems, sends)).toEqual([]);
  });
});
