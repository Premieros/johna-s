import type { Permission } from './permissionDefs';
import type { OrderType } from './types';

export const ORDER_TYPE_PERMISSION: Record<OrderType, Permission> = {
  dine_in: 'pos.order.dine_in',
  takeaway: 'pos.order.takeaway',
  drive_thru: 'pos.order.drive_thru',
  delivery: 'pos.order.delivery',
};

/** Unknown types and non-table orders carrying a table binding fail closed. */
export function canOperateOrderType(can: (permission: Permission) => boolean, type: string, tableId?: string | null): boolean {
  if (!Object.prototype.hasOwnProperty.call(ORDER_TYPE_PERMISSION, type)) return false;
  if (tableId && type !== 'dine_in') return false;
  return can(ORDER_TYPE_PERMISSION[type as OrderType]);
}
