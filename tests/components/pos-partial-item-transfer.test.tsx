import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CartItem, DiningTable, OrderItem } from '@/lib/types';
const m = vi.hoisted(() => ({ move: vi.fn(), tables: vi.fn() }));
vi.mock('@/api', () => ({
 pos: { transferOrderItemsToTable: m.move },
 supabase: { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ order: m.tables }) }) }) }) },
}));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ lang: 'en' }) }));
import { TransferItemsModal } from '@/features/pos/components/tables/TransferItemsModal';
const saved = { id: 'line-1', order_id: 'order-1', product_id: 'water', unit_name: 'piece', quantity: 3, unit_price: 20, discount_amount: 0, bonus_quantity: 0, notes: null, modifier_option_ids: [] } as unknown as OrderItem;
const item = { product: { id: 'water', name: 'Water' }, order_item_id: 'line-1', quantity: 3 } as CartItem;
const table = { id: 'source', branch_id: 'branch', name: 'Source' } as DiningTable;
const success = { success: true, source_order_id: 'order-1', snapshot: { order_ids: ['order-1', 'order-2'], orders: [], tables: [], orderItems: [], kitchenSends: [] }, quantity_transfers: [{ source_item_id: 'line-1', moved_item_id: 'new-line', quantity: 1 }] };
beforeEach(() => { vi.resetAllMocks(); m.tables.mockResolvedValue({ data: [{ id: 'target', branch_id: 'branch', name: 'Target', status: 'occupied' }], error: null }); });
async function open() {
 const completed = vi.fn(), close = vi.fn();
 render(<TransferItemsModal open onClose={close} lines={[{ item, orderItemId: saved.id, saved }]} orderId="order-1" sourceTable={table} onCompleted={completed} />);
 fireEvent.click(await screen.findByTestId('transfer-items-target-target'));
 return { completed, close, qty: screen.getByLabelText('Transfer quantity Water'), button: screen.getByRole('button', { name: 'Move selected' }) };
}
describe('partial item transfer form', () => {
 it('sends the chosen one from three with exact saved identity, and submits once while pending', async () => {
  let resolve!: (value: unknown) => void; m.move.mockImplementation(() => new Promise((r) => { resolve = r; }));
  const { qty, button, completed } = await open(); fireEvent.change(qty, { target: { value: '1' } });
  fireEvent.click(button); fireEvent.click(button);
  expect(m.move).toHaveBeenCalledTimes(1);
  expect(m.move.mock.calls[0][0]).toMatchObject({ p_order_item_ids: ['line-1'], p_transfer: { operation_id: expect.any(String), quantities: [{ order_item_id: 'line-1', quantity: 1, expected: { quantity: 3, product_id: 'water' } }] } });
  await act(async () => resolve({ data: success, error: null })); expect(completed).toHaveBeenCalledWith(success);
 });
 it('keeps the exact command and UUID on an unknown outcome, including when realtime changes the source', async () => {
  m.move.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ data: { ...success, replayed: true }, error: null });
  const { qty, button, completed, close } = await open(); fireEvent.change(qty, { target: { value: '1' } }); fireEvent.click(button);
  const retry = await screen.findByRole('button', { name: 'Verify and retry' });
  expect(qty).toBeDisabled(); expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled(); expect(close).not.toHaveBeenCalled();
  const original = m.move.mock.calls[0][0]; fireEvent.click(retry);
  await waitFor(() => expect(completed).toHaveBeenCalledTimes(1)); expect(m.move.mock.calls[1][0]).toEqual(original);
 });
 it('blocks zero, excess and overprecision quantities', async () => {
  const { qty, button } = await open();
  for (const value of ['0', '4', '0.00001', '']) { fireEvent.change(qty, { target: { value } }); expect(button).toBeDisabled(); }
  expect(m.move).not.toHaveBeenCalled();
 });
 it('allows correction after a definite atomic server rejection', async () => {
  m.move.mockResolvedValue({ data: { success: false, error: 'TRANSFER_SOURCE_CHANGED' }, error: null });
  const { qty, button, completed } = await open(); fireEvent.click(button);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()); expect(qty).toBeEnabled(); expect(completed).not.toHaveBeenCalled();
 });
});
