import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiningTable, Order } from '@/lib/types';
const grants = vi.hoisted(() => new Set<string>());
vi.mock('@/lib/permissions', () => ({ useCan: () => (key: string) => grants.has(key) }));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ lang: 'en', t: (key: string) => key }) }));
vi.mock('@/components/Modal', () => ({ Modal: ({children}: {children: React.ReactNode}) => <div>{children}</div> }));
import { TableActionModal } from '@/features/pos/components/start/TableActionModal';
const table = {id: 'table', name: 'Table', status: 'vacant', capacity: 2} as DiningTable;
const order = {id: 'order', table_id: table.id, order_type: 'dine_in', order_number: 'TEST', total: 20, status: 'open'} as Order;
const props = {table, onClose: vi.fn(), orders: [], itemsByOrder: {}, kitchenSendsByOrder: {}, currency: 'EGP', onStart: vi.fn(), onResume: vi.fn(), onPay: vi.fn()};
afterEach(() => {cleanup(); grants.clear(); vi.clearAllMocks();});
describe('table actions keep order types and payment independent', () => {
  it('cannot start a table with only quick permission', () => {
    grants.add('pos.order.takeaway'); render(<TableActionModal {...props} />);
    expect(screen.queryByRole('button', {name: 'startOrder'})).not.toBeInTheDocument();
  });
  it('can start a table with its type permission', () => {
    grants.add('pos.order.dine_in'); render(<TableActionModal {...props} />);
    fireEvent.click(screen.getByRole('button', {name: 'startOrder'})); expect(props.onStart).toHaveBeenCalledOnce();
  });
  it('does not expose payment from the type permission alone', () => {
    grants.add('pos.order.dine_in'); render(<TableActionModal {...props} orders={[order]} />);
    expect(screen.queryByRole('button', {name: 'payOrder'})).not.toBeInTheDocument();
  });
  it('allows a payment-only cashier to reach payment without a table-create permission', () => {
    grants.add('pos.payment.take'); render(<TableActionModal {...props} orders={[order]} />);
    fireEvent.click(screen.getByRole('button', {name: 'payOrder'})); expect(props.onPay).toHaveBeenCalledWith(order);
  });
});
