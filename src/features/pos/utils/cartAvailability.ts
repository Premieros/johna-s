import type { CartItem, OrderItem } from '@/lib/types';
import type { OrderKitchenSend } from '../types';
import { cartLineKey, orderItemLineKey } from './cart';

export interface CartAvailabilityItem {
  product_id: string;
  quantity: number;
}

/**
 * Build the virtual inventory demand for the current cart.
 * Sent kitchen quantities are already reflected in physical stock, so only the
 * unsent delta may be projected against current warehouse availability.
 */
export function computeUnsentCartDemand(
  cart: CartItem[],
  orderItems: OrderItem[] = [],
  kitchenSends: OrderKitchenSend[] = [],
): CartAvailabilityItem[] {
  const sentByOrderItem = new Map<string, number>();
  for (const send of kitchenSends) {
    const qty = Math.max(0, Number(send.sent_quantity || 0));
    // sent_quantity is cumulative. Keep the highest observed value if a stale
    // duplicate row appears rather than summing cumulative snapshots.
    sentByOrderItem.set(send.order_item_id, Math.max(sentByOrderItem.get(send.order_item_id) || 0, qty));
  }

  const demandByProduct = new Map<string, number>();
  for (const item of cart) {
    const matching = orderItems.find((row) => orderItemLineKey(row) === cartLineKey(item));
    const sent = matching ? sentByOrderItem.get(matching.id) || 0 : 0;
    const unsent = Math.max(Number(item.quantity || 0) - sent, 0);
    if (unsent <= 0) continue;
    demandByProduct.set(item.product.id, (demandByProduct.get(item.product.id) || 0) + unsent);
  }

  return [...demandByProduct.entries()].map(([product_id, quantity]) => ({ product_id, quantity }));
}
