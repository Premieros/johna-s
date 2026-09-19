import { useMemo } from 'react';
import { useCan } from '@/lib/permissions';

export interface PosPermissions {
  canViewPos: boolean;
  canCreateOrder: boolean;
  canEditOrder: boolean;
  canDeleteItem: boolean;
  canApplyDiscount: boolean;
  canDiscount: boolean;
  canChangePrice: boolean;
  canHoldOrder: boolean;
  canSendKitchen: boolean;
  canViewKitchen: boolean;
  canPrintKitchen: boolean;
  canPay: boolean;
  canCancelOrder: boolean;
  canTransferOrder: boolean;
  canSplitOrder: boolean;
  canOpenShift: boolean;
  canCloseShift: boolean;
  canPrint: boolean;
  canChangeBranch: boolean;
  canManageCustomer: boolean;
}

/**
 * POS permissions are resolved from the DB-backed roles.permissions map through
 * useCan(). Never infer operational access from hard-coded role names here.
 */
export function usePosPermissions(): PosPermissions {
  const can = useCan();

  return useMemo<PosPermissions>(() => ({
    canViewPos: can('pos.view'),
    canCreateOrder: can('pos.order.create'),
    canEditOrder: can('pos.order.edit'),
    canDeleteItem: can('pos.void'),
    canApplyDiscount: can('pos.discount'),
    canDiscount: can('pos.discount'),
    canChangePrice: can('pos.change_price'),
    canHoldOrder: can('pos.hold'),
    canSendKitchen: can('pos.send_kitchen'),
    canViewKitchen: can('pos.kds_view'),
    canPrintKitchen: can('pos.print_kitchen'),
    canPay: can('pos.payment.take'),
    canCancelOrder: can('pos.cancel_order'),
    canTransferOrder: can('pos.order.transfer'),
    canSplitOrder: can('pos.order.split'),
    canOpenShift: can('shifts.open'),
    canCloseShift: can('shifts.close'),
    canPrint: can('pos.receipt.print'),
    canChangeBranch: can('pos.change_branch'),
    canManageCustomer: can('customers.manage'),
  }), [can]);
}
