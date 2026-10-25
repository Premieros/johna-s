import { useMemo } from 'react';
import { ORDER_TYPE_PERMISSION, canOperateOrderType } from '@/lib/posOrderPermissions';
import type { OrderType } from '@/lib/types';
import { useCan } from '@/lib/permissions';

export interface PosPermissions {
  canViewPos: boolean;
  canCreateOrder: boolean;
  canCreateQuickOrder: boolean;
  canEditOrder: boolean;
  canDeleteItem: boolean;
  canVoidSentItem: boolean;
  canApplyDiscount: boolean;
  canDiscount: boolean;
  canChangePrice: boolean;
  canHoldOrder: boolean;
  canOperateType: (type: OrderType, tableId?: string | null) => boolean;
  canCreateDelivery: boolean;
  canCreateDriveThru: boolean;
  canCreateAnyOrder: boolean;
  canViewKitchen: boolean;
  canPrintKitchen: boolean;
  canPay: boolean;
  canCancelOrder: boolean;
  canTransferOrder: boolean;
  canSplitOrder: boolean;
  canOpenShift: boolean;
  canCloseShift: boolean;
  canPrint: boolean;
  canReprint: boolean;
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
    canCreateOrder: can('pos.order.dine_in'),
    canCreateQuickOrder: can('pos.order.takeaway'),
    canEditOrder: can('pos.order.edit'),
    // Unsent line removal is an order edit. Sent-item Void stays a separate
    // direct capability; users without it can still enter the approval path.
    canDeleteItem: can('pos.order.edit'),
    canVoidSentItem: can('pos.void'),
    canApplyDiscount: can('pos.discount'),
    canDiscount: can('pos.discount'),
    canChangePrice: can('pos.change_price'),
    canHoldOrder: can('pos.hold'),
    canOperateType: (type, tableId) => canOperateOrderType(can, type, tableId),
    canCreateDelivery: can('pos.order.delivery'),
    canCreateDriveThru: can('pos.order.drive_thru'),
    canCreateAnyOrder: Object.values(ORDER_TYPE_PERMISSION).some(key => can(key)),
    canViewKitchen: can('pos.kds_view'),
    canPrintKitchen: can('pos.print_kitchen'),
    canPay: can('pos.payment.take'),
    canCancelOrder: can('pos.cancel_order'),
    canTransferOrder: can('pos.order.transfer'),
    canSplitOrder: can('pos.order.split'),
    canOpenShift: can('shifts.open'),
    canCloseShift: can('shifts.close'),
    canPrint: can('pos.receipt.print'),
    canReprint: can('pos.reprint'),
    canChangeBranch: can('pos.change_branch'),
    canManageCustomer: can('customers.manage'),
  }), [can]);
}
