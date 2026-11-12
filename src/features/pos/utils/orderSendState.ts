import type { CartItem } from '@/lib/types';
import type { KitchenSendItem } from '../types';
import { cartConfigurationKey, orderItemLineKey } from './cart';

/** Conservative first-send fallback while the canonical Realtime item row is in flight. */
export function confirmedSessionSendQuantity(item: CartItem, sends: KitchenSendItem[]): number {
  const matches = sends.filter((sent) => sent.product_id === item.product.id && (item.order_item_id
    ? sent.order_item_id === item.order_item_id
    : orderItemLineKey({
      product_id: sent.product_id || '',
      modifier_option_ids: (sent.modifiers || []).map((modifier) => modifier.option_id),
      notes: sent.notes,
    }) === cartConfigurationKey(item)));
  if (matches.length !== 1) return 0;
  // quantity is the confirmed delta. Never assume an incremental delta covers
  // an entire older line; the canonical snapshot will supply cumulative sends.
  const quantity = Number(matches[0].quantity);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
}
