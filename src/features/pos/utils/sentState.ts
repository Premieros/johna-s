import type { CartItem, OrderItem } from '@/lib/types';
import type { KitchenSendItem } from '../types';
import { cartLineKey, orderItemLineKey } from './cart';

export interface SentLineState {
  sentQty: number;
  newQty: number;
  sent: boolean;
  partial: boolean;
}

// Order-line identity includes product + modifier selection + item note. This
// prevents a Burger Single kitchen state from leaking onto a Burger Double line.
export function computeSentState(
  cart: CartItem[],
  orderItems: OrderItem[],
  sentOrderItemIds: Set<string>,
  sessionSent: KitchenSendItem[],
): Record<string, SentLineState> {
  const qtyByLine: Record<string, number> = {};
  for (const item of cart) qtyByLine[cartLineKey(item)] = item.quantity;

  const map: Record<string, SentLineState> = {};
  for (const lineKey of Object.keys(qtyByLine)) {
    map[lineKey] = { sentQty: 0, newQty: qtyByLine[lineKey], sent: false, partial: false };
  }

  const orderItemKeyById = new Map<string, string>();
  for (const oi of orderItems) {
    const persistedLineKey = `order-item:${oi.id}`;
    const lineKey = map[persistedLineKey] ? persistedLineKey : orderItemLineKey(oi);
    orderItemKeyById.set(oi.id, lineKey);
    if (!map[lineKey] || !sentOrderItemIds.has(oi.id)) continue;
    map[lineKey].sentQty += Math.max(0, Number(oi.quantity) || 0);
  }

  for (const s of sessionSent) {
    const lineKey = orderItemKeyById.get(s.order_item_id);
    if (!lineKey || !map[lineKey]) continue;
    const qty = Math.max(0, Number(s.quantity) || 0);
    if (qty > map[lineKey].sentQty) map[lineKey].sentQty = qty;
  }

  for (const lineKey of Object.keys(map)) {
    const qty = qtyByLine[lineKey];
    const sent = Math.min(map[lineKey].sentQty, qty);
    map[lineKey].sentQty = sent;
    map[lineKey].newQty = Math.max(0, qty - sent);
    map[lineKey].sent = sent > 0 && map[lineKey].newQty === 0;
    map[lineKey].partial = sent > 0 && map[lineKey].newQty > 0;
  }

  return map;
}
