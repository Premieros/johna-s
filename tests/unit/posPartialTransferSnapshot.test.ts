import { describe, expect, it } from 'vitest';
import type { CartItem, Order, OrderItem } from '@/lib/types';
import type { PosItemTransferResult, PosRealtimeData } from '@/features/pos/types';
import { applyItemTransferToCart, mergeItemTransferSnapshot, transferLineIsSaved } from '@/features/pos/utils/itemTransfer';
const product = { id: 'water', name: 'Water' };
const cart = (id?: string, quantity = 3) => ({ product, order_item_id: id, quantity, unit_name: 'piece', unit_price: 20, discount_amount: 0, bonus_quantity: 0, modifier_option_ids: [] }) as unknown as CartItem;
const row = { id: 'a', order_id: 'source', product_id: 'water', quantity: 2, unit_name: 'piece', unit_price: 20, discount_amount: 0, bonus_quantity: 0, modifier_option_ids: [], notes: '', total: 40, created_at: '' } as OrderItem;
const result: PosItemTransferResult = { success: true, source_order_id: 'source', quantity_transfers: [{ source_item_id: 'a', moved_item_id: 'c', quantity: 1 }], snapshot: { order_ids: ['source', 'target'], orders: [{ id: 'source', branch_id: 'branch', status: 'open' }, { id: 'target', branch_id: 'branch', status: 'open' }] as Order[], tables: [], orderItems: [row, { ...row, id: 'c', order_id: 'target', quantity: 1 }], kitchenSends: [] } };
describe('authoritative quantity transfer snapshots', () => {
 it('retains exact IDs and unsaved edits on other same-product rows, and replay cannot subtract twice', () => {
  const before = [cart('a'), cart('b', 9), cart(undefined, 4)]; const after = applyItemTransferToCart(before, result);
  expect(after.map(i => [i.order_item_id, i.quantity])).toEqual([['a', 2], ['b', 9], [undefined, 4]]);
  expect(applyItemTransferToCart(after, { ...result, replayed: true })).toEqual(after);
 });
 it('removes only the transferred persisted ID when the server source is empty', () => {
  const r = { ...result, snapshot: { ...result.snapshot!, orderItems: [] } };
  expect(applyItemTransferToCart([cart('a'), cart('b'), cart()], r).map(i => i.order_item_id)).toEqual(['b', undefined]);
 });
 it('refreshes two affected orders and tables without wiping the rest of the branch, and ignores another branch', () => {
  const data = { orders: [{ id: 'other' }], tables: [], orderItems: [{ ...row, id: 'other-line', order_id: 'other' }], kitchenSends: [], watchedOrderIds: ['other'] } as unknown as PosRealtimeData;
  const next = mergeItemTransferSnapshot(data, result.snapshot!, 'branch'); expect(next.orders.map(o => o.id)).toEqual(['other', 'source', 'target']); expect(next.orderItems.map(i => i.id)).toEqual(['other-line', 'a', 'c']);
  expect(mergeItemTransferSnapshot(data, result.snapshot!, 'another')).toBe(data);
 });
 it('requires saved quantity and configuration before transferring a selected row', () => {
  expect(transferLineIsSaved(cart('a', 2), row)).toBe(true);
  expect(transferLineIsSaved(cart('a', 3), row)).toBe(false);
  expect(transferLineIsSaved({ ...cart('a', 2), item_note: 'different' }, row)).toBe(false);
 });
});
