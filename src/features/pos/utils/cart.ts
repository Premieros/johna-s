import type { CartItem, OrderItem, Product } from '@/lib/types';

export interface ItemPayload {
  product_id: string;
  unit_name: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  bonus_quantity: number;
  total: number;
  modifier_option_ids: string[];
  notes?: string | null;
}

const modifierIdsFromCart = (item: Pick<CartItem, 'modifier_option_ids' | 'modifiers'>): string[] => {
  const explicit = item.modifier_option_ids || [];
  if (explicit.length > 0) return explicit;
  return (item.modifiers || []).flatMap((modifier) => modifier.id ? [modifier.id] : []);
};

const normalizedModifierIds = (ids?: string[]) => [...(ids || [])].sort();

export function cartConfigurationKey(item: Pick<CartItem, 'product' | 'modifier_option_ids' | 'modifiers' | 'item_note'>): string {
  return `${item.product.id}|${normalizedModifierIds(modifierIdsFromCart(item)).join(',')}|${item.item_note || ''}`;
}

export function cartLineKey(item: Pick<CartItem, 'product' | 'modifier_option_ids' | 'modifiers' | 'item_note' | 'order_item_id'>): string {
  return item.order_item_id ? `order-item:${item.order_item_id}` : cartConfigurationKey(item);
}

export function orderItemLineKey(item: Pick<OrderItem, 'product_id' | 'modifier_option_ids' | 'notes'>): string {
  return `${item.product_id || ''}|${normalizedModifierIds(item.modifier_option_ids).join(',')}|${item.notes || ''}`;
}

export function sameCartConfiguration(a: Pick<CartItem, 'product' | 'modifier_option_ids' | 'modifiers' | 'item_note'>, b: Pick<CartItem, 'product' | 'modifier_option_ids' | 'modifiers' | 'item_note'>): boolean {
  return cartConfigurationKey(a) === cartConfigurationKey(b);
}

export function cartToItems(cart: CartItem[]): ItemPayload[] {
  return cart.map((i) => ({
    product_id: i.product.id,
    unit_name: i.unit_name,
    quantity: i.quantity,
    unit_price: i.unit_price,
    discount_amount: i.discount_amount,
    bonus_quantity: i.bonus_quantity,
    total: i.quantity * i.unit_price - i.discount_amount,
    modifier_option_ids: modifierIdsFromCart(i),
    notes: i.item_note || null,
  }));
}

export function orderItemsToCart(items: OrderItem[], products: Product[]): CartItem[] {
  const prodMap: Record<string, Product> = {};
  for (const p of products) prodMap[p.id] = p;
  return items
    .map((i) => ({
      product: prodMap[i.product_id || ''],
      unit_name: i.unit_name,
      quantity: Number(i.quantity),
      unit_price: Number(i.unit_price),
      discount_amount: Number(i.discount_amount),
      bonus_quantity: Number(i.bonus_quantity),
      order_item_id: i.id,
      modifier_option_ids: i.modifier_option_ids || [],
      modifiers: (i.modifiers_snapshot || []).map((m) => ({
        id: m.option_id,
        group_name: m.group_name,
        name: m.option_name,
        price_delta: Number(m.price_delta || 0),
      })),
      item_note: i.notes || undefined,
    }))
    .filter((i) => i.product)
    .map((i) => ({ ...i, product: i.product as Product }));
}

export function cartSubtotal(cart: CartItem[]): number {
  return cart.reduce((s, i) => s + i.quantity * i.unit_price - i.discount_amount, 0);
}
