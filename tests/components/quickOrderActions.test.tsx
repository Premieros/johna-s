import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
const granted = vi.hoisted(() => new Set(['pos.order.takeaway']));
vi.mock('@/lib/permissions', () => ({ useCan: () => (key: string) => granted.has(key) }));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ lang: 'ar', t: (key: string) => key }) }));
vi.mock('@/context/ThemeContext', () => ({ useTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null, signOut: vi.fn() }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useLocation: () => ({ pathname: '/pos/order/test' }) }));
vi.mock('@/components/Logo', () => ({ Logo: () => null }));
vi.mock('@/features/pos/services/offlinePos', () => ({ offlinePosManager: { getPendingCount: () => 0, syncAllPending: vi.fn() } }));
import { PosOrderHeaderBar } from '@/features/pos/components/order/PosOrderHeaderBar';
import { PosTopBar } from '@/features/pos/components/topbar/PosTopBar';

afterEach(() => { vi.clearAllMocks(); cleanup(); granted.clear(); granted.add('pos.order.takeaway'); });
const headerProps: ComponentProps<typeof PosOrderHeaderBar> = {
  orderNumber: null, orderId: null, activeTable: null, orderType: 'takeaway', itemsCount: 1,
  canPrintReceipt: false, canModifyOrder: true, total: 1, currency: 'EGP', createdAt: null,
  kitchenSends: [], kitchenSending: false, completing: false, hasUnsentItems: true,
  onOpenCustomer: vi.fn(), onHoldOrder: vi.fn(), onSendKitchen: vi.fn(), onPrint: vi.fn(), onPay: vi.fn(),
};

describe('quick-order access without broadening kitchen permissions', () => {
  it('sends a quick order with its single type capability', () => {
    render(<PosOrderHeaderBar {...headerProps} />);
    fireEvent.click(screen.getByTestId('pos-action-send-kitchen'));
    expect(headerProps.onSendKitchen).toHaveBeenCalledOnce();
  });

  it('cannot send a table order with only the quick capability', () => {
    render(<PosOrderHeaderBar {...headerProps} orderType="dine_in" />);
    expect(screen.getByTestId('pos-action-send-kitchen')).toBeDisabled();fireEvent.click(screen.getByTestId('pos-action-send-kitchen'));expect(headerProps.onSendKitchen).not.toHaveBeenCalled();
  });

  it('cannot send quick orders with only table or legacy dispatch capabilities', () => {
    granted.clear(); granted.add('pos.order.dine_in'); granted.add('pos.send_kitchen');
    render(<PosOrderHeaderBar {...headerProps} />);
    expect(screen.getByTestId('pos-action-send-kitchen')).toBeDisabled();fireEvent.click(screen.getByTestId('pos-action-send-kitchen'));expect(headerProps.onSendKitchen).not.toHaveBeenCalled();
  });

  it('opens the dedicated quick-order list without starting or resetting an order', () => {
    const onOpenQuickOrders = vi.fn();
    const onNewOrder = vi.fn();
    const onPanel = vi.fn();
    render(<PosTopBar panel={null} onPanel={onPanel} onOpenQuickOrders={onOpenQuickOrders}
      counts={{ activeOrders: 8, takeawayOrders: 3, occupiedTables: 5, kitchenOrders: 0, heldOrders: 0, deliveryOrders: 0 }}
      branchId="test" branches={[]} canChangeBranch={false} onBranchChange={vi.fn()}
      shiftChecked={true} activeShift={null} onNewOrder={onNewOrder} onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'الطلبات السريعة المفتوحة: 3' }));
    expect(onOpenQuickOrders).toHaveBeenCalledOnce();
    expect(onNewOrder).not.toHaveBeenCalled();
    expect(onPanel).not.toHaveBeenCalled();
  });
});

describe('human action buttons do not control print-agent execution',()=>{
 it('keeps denied order actions visible but disabled and blocks clicks',()=>{
  granted.clear();const transfer=vi.fn();
  render(<PosOrderHeaderBar {...headerProps} orderId="order" canModifyOrder={false} activeTable={{id:'table',name:'1'} as ComponentProps<typeof PosOrderHeaderBar>['activeTable']} canPrintReceipt kitchenSends={[{}] as ComponentProps<typeof PosOrderHeaderBar>['kitchenSends']} onOpenTransferModal={transfer}/>);
  for(const id of ['pos-action-print','pos-action-pay','pos-action-send-kitchen','pos-action-hold','pos-top-action-merge-transfer','pos-top-action-customer']){const b=screen.getByTestId(id);expect(b).toBeDisabled();fireEvent.click(b);}
  for(const callback of [transfer,headerProps.onPrint,headerProps.onPay,headerProps.onSendKitchen,headerProps.onHoldOrder,headerProps.onOpenCustomer])expect(callback).not.toHaveBeenCalled();
 });
 it('enables first receipt and payment independently from order-type send permission',()=>{
  granted.clear();granted.add('pos.receipt.print');granted.add('pos.payment.take');
  render(<PosOrderHeaderBar {...headerProps} canPrintReceipt kitchenSends={[{}] as ComponentProps<typeof PosOrderHeaderBar>['kitchenSends']}/>);
  expect(screen.getByTestId('pos-action-send-kitchen')).toBeDisabled();fireEvent.click(screen.getByTestId('pos-action-print'));fireEvent.click(screen.getByTestId('pos-action-pay'));
  expect(headerProps.onPrint).toHaveBeenCalledOnce();expect(headerProps.onPay).toHaveBeenCalledOnce();expect(headerProps.onSendKitchen).not.toHaveBeenCalled();
 });
});

 it.each([{kitchenSending:true,completing:false},{kitchenSending:false,completing:true}])('blocks authorized send clicks while busy: %j',(busy)=>{
  render(<PosOrderHeaderBar {...headerProps} {...busy}/>);const button=screen.getByTestId('pos-action-send-kitchen');expect(button).toBeDisabled();fireEvent.click(button);expect(headerProps.onSendKitchen).not.toHaveBeenCalled();
 });
