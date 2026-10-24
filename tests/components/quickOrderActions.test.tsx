import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
const granted = vi.hoisted(() => new Set(['pos.order.quick_create']));
vi.mock('@/lib/permissions', () => ({ useCan: () => (key: string) => granted.has(key) }));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ lang: 'ar', t: (key: string) => key }) }));
vi.mock('@/context/ThemeContext', () => ({ useTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null, signOut: vi.fn() }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useLocation: () => ({ pathname: '/pos/order/test' }) }));
vi.mock('@/components/Logo', () => ({ Logo: () => null }));
vi.mock('@/features/pos/services/offlinePos', () => ({ offlinePosManager: { getPendingCount: () => 0, syncAllPending: vi.fn() } }));
import { PosOrderHeaderBar } from '@/features/pos/components/order/PosOrderHeaderBar';
import { PosTopBar } from '@/features/pos/components/topbar/PosTopBar';

afterEach(() => { cleanup(); granted.clear(); granted.add('pos.order.quick_create'); });
const headerProps: ComponentProps<typeof PosOrderHeaderBar> = {
  orderNumber: null, orderId: null, activeTable: null, orderType: 'takeaway', itemsCount: 1,
  canPrintReceipt: false, canModifyOrder: true, total: 1, currency: 'EGP', createdAt: null,
  kitchenSends: [], kitchenSending: false, completing: false, hasUnsentItems: true,
  onOpenCustomer: vi.fn(), onHoldOrder: vi.fn(), onSendKitchen: vi.fn(), onPrint: vi.fn(), onPay: vi.fn(),
};

describe('quick-order access without broadening kitchen permissions', () => {
  it('explains missing kitchen permission and cannot dispatch', () => {
    render(<PosOrderHeaderBar {...headerProps} />);
    const send = screen.getByRole('button', { name: 'إرسال للمطبخ' });
    expect(send).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('صلاحية «إرسال للمطبخ»');
    fireEvent.click(send);
    expect(headerProps.onSendKitchen).not.toHaveBeenCalled();
  });

  it('dispatches through the existing action when explicitly permitted', () => {
    granted.add('pos.send_kitchen');
    render(<PosOrderHeaderBar {...headerProps} />);
    fireEvent.click(screen.getByTestId('pos-action-send-kitchen'));
    expect(headerProps.onSendKitchen).toHaveBeenCalledOnce();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
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
