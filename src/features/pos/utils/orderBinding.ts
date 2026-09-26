import type { OrderType } from '@/lib/types';

interface OrderBindingInput {
  activeOrderId: string | null;
  orderType: OrderType;
  tableId: string | null;
  activeTableId?: string | null;
}

export interface OrderBindingForSave {
  orderType: OrderType;
  tableId: string | null;
}

/**
 * Ordinary POS saves are not an authorization boundary for detaching a table.
 * Once an active order has a known table binding, preserve that binding and
 * dine-in type until the explicit detach/transfer RPC succeeds and clears the
 * active workspace.
 */
export function resolveOrderBindingForSave(input: OrderBindingInput): OrderBindingForSave {
  const knownTableId = input.tableId || input.activeTableId || null;

  if (input.activeOrderId && knownTableId) {
    return { orderType: 'dine_in', tableId: knownTableId };
  }

  return {
    orderType: input.orderType,
    tableId: input.orderType === 'dine_in' ? knownTableId : null,
  };
}
