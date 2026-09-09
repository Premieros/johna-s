import type { Order } from '@/lib/types';

export function orderOperatorName(order: Pick<Order, 'cashier'>): string | null {
  const fullName = order.cashier?.full_name?.trim();
  if (fullName) return fullName;

  const email = order.cashier?.email?.trim();
  return email || null;
}
