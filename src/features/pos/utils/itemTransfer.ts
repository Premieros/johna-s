import type { CartItem, OrderItem } from '@/lib/types';
import type { PosItemTransferRequest, PosItemTransferResult, PosItemTransferSnapshot, PosRealtimeData } from '../types';
import { cartToItems, orderItemsToCart } from './cart';

export function transferExpectedLine(row: OrderItem): PosItemTransferRequest['quantities'][number]['expected'] {
  return {
    quantity: row.quantity, product_id: row.product_id, unit_name: row.unit_name,
    unit_price: row.unit_price, discount_amount: row.discount_amount, bonus_quantity: row.bonus_quantity,
    notes: row.notes || '', modifier_option_ids: row.modifier_option_ids || [],
  };
}

export function transferLineIsSaved(item: CartItem, row: OrderItem): boolean {
  const payload = cartToItems([item])[0];
  return payload.product_id === row.product_id && payload.unit_name === row.unit_name
    && payload.quantity === Number(row.quantity) && payload.unit_price === Number(row.unit_price)
    && payload.discount_amount === Number(row.discount_amount) && payload.bonus_quantity === Number(row.bonus_quantity)
    && (payload.notes || '') === (row.notes || '')
    && [...payload.modifier_option_ids].sort().join(',') === [...(row.modifier_option_ids || [])].sort().join(',');
}

// Replace the exact affected IDs from the server; never subtract again on replay
// or merge identical products. Unsaved edits on other lines remain untouched.
export function applyItemTransferToCart(cart: CartItem[], result: PosItemTransferResult): CartItem[] {
  const affected = new Set(result.quantity_transfers?.map((move) => move.source_item_id) || []);
  const rows = new Map(result.snapshot?.orderItems.filter((row) => row.order_id === result.source_order_id).map((row) => [row.id, row]));
  return cart.flatMap((item) => {
    if (!item.order_item_id || !affected.has(item.order_item_id)) return [item];
    const row = rows.get(item.order_item_id);
    return row ? orderItemsToCart([row], [item.product]) : [];
  });
}

export function mergeItemTransferSnapshot(data: PosRealtimeData, snapshot: PosItemTransferSnapshot, branchId: string): PosRealtimeData {
  if (!snapshot.orders.length || snapshot.orders.some((order) => order.branch_id !== branchId)) return data;
  const affected = new Set(snapshot.order_ids);
  if (snapshot.orders.some((order) => !affected.has(order.id))) return data;
  const active = snapshot.orders.filter((order) => order.status === 'open' || order.status === 'held');
  const tableIds = new Set(snapshot.tables.map((table) => table.id));
  return {
    orders: [...data.orders.filter((order) => !affected.has(order.id)), ...active],
    tables: [...data.tables.filter((table) => !tableIds.has(table.id)), ...snapshot.tables],
    orderItems: [...data.orderItems.filter((row) => !affected.has(row.order_id)), ...snapshot.orderItems],
    kitchenSends: [...data.kitchenSends.filter((row) => !affected.has(row.order_id)), ...snapshot.kitchenSends],
    watchedOrderIds: [...data.watchedOrderIds.filter((id) => !affected.has(id)), ...active.map((order) => order.id)],
  };
}
