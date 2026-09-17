import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const basePrintReceipt = vi.fn(async () => undefined);
const fetchOrderSettlementPreview = vi.fn();

vi.mock('@/context/LanguageContext', () => ({
  useLanguage: () => ({
    lang: 'en',
    t: (key: string) => key,
  }),
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => ({ show: vi.fn() }),
}));

vi.mock('@/features/pos/hooks/usePosPermissions', () => ({
  usePosPermissions: () => ({ canEditOrder: true }),
}));

vi.mock('@/features/pos/services/settlementPreview', () => ({
  fetchOrderSettlementPreview: (...args: unknown[]) => fetchOrderSettlementPreview(...args),
}));

vi.mock('@/features/pos/hooks/usePosOrderBase', () => ({
  usePosOrder: () => ({
    cart: [{ product: { id: 'product-1', name: 'Item' }, quantity: 1 }],
    activeOrderId: 'order-1',
    activeOrderNumber: 'ORD-1',
    activeTable: null,
    customerId: '',
    guestCount: 1,
    orderType: 'takeaway',
    checkoutOpen: false,
    printReceipt: basePrintReceipt,
  }),
}));

import { usePosOrder } from '@/features/pos/hooks/usePosOrder';

describe('POS open-order printing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prints the live open-order receipt without loading settlement preview', async () => {
    const input = {
      branchId: 'branch-1',
      branchName: 'Branch 1',
      products: [],
      customers: [],
      effSettings: { receipt_width_mm: 80 },
    } as any;

    const { result } = renderHook(() => usePosOrder(input));

    await act(async () => {
      await result.current.printReceipt();
    });

    expect(basePrintReceipt).toHaveBeenCalledTimes(1);
    expect(fetchOrderSettlementPreview).not.toHaveBeenCalled();
  });
});
