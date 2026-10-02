import { supabase, pos as posApi } from '@/api';
import type { Branch, Customer, DiningTable, Order, OrderItem, Product } from '@/lib/types';
import type { OrderKitchenSend, PosRealtimeData } from '../types';

export const EMPTY_POS_REALTIME: PosRealtimeData = {
  orders: [],
  tables: [],
  orderItems: [],
  kitchenSends: [],
  watchedOrderIds: [],
};

type PosOrderOperatorLabel = {
  order_id: string;
  cashier_id: string | null;
  operator_name: string | null;
};

type ActiveOrderSnapshotRow = Order & {
  order_items?: OrderItem[] | null;
  order_kitchen_sends?: OrderKitchenSend[] | null;
};

const OPERATOR_LABEL_CACHE_TTL_MS = 15_000;

type OperatorLabelCacheEntry = {
  signature: string;
  fetchedAt: number;
  labels: PosOrderOperatorLabel[];
};

const operatorLabelCache = new Map<string, OperatorLabelCacheEntry>();

function activeOrderOperatorSignature(rows: ActiveOrderSnapshotRow[]): string {
  return rows
    .map((row) => `${row.id}:${row.cashier_id ?? ''}`)
    .sort()
    .join('|');
}

async function getOperatorLabels(branchId: string, rows: ActiveOrderSnapshotRow[]): Promise<PosOrderOperatorLabel[]> {
  const signature = activeOrderOperatorSignature(rows);
  const now = Date.now();
  const cached = operatorLabelCache.get(branchId);
  if (cached && cached.signature === signature && now - cached.fetchedAt < OPERATOR_LABEL_CACHE_TTL_MS) {
    return cached.labels;
  }

  const operatorRes = await supabase.rpc('get_pos_order_operator_labels', { p_branch_id: branchId });
  const labels = (operatorRes.data as PosOrderOperatorLabel[] | null) || [];
  operatorLabelCache.set(branchId, { signature, fetchedAt: now, labels });
  return labels;
}


type PosOrderAccessResult = {
  success?: boolean;
  error?: string;
  order_id?: string;
  branch_id?: string;
  cashier_id?: string | null;
  managed_other?: boolean;
};

export type MyActiveTableOrderResolution = {
  success?: boolean;
  error?: string;
  resumable?: boolean;
  order_id?: string;
};

export async function fetchActiveOrders(branchId: string): Promise<PosRealtimeData> {
  const [tRes, oRes] = await Promise.all([
    supabase.from('dining_tables').select('*').eq('branch_id', branchId).eq('is_active', true).order('name'),
    supabase.from('orders')
      .select('*, table:dining_tables(*), order_items!order_items_order_id_fkey(*), order_kitchen_sends!order_kitchen_sends_order_id_fkey(*)')
      .eq('branch_id', branchId)
      .in('status', ['open', 'held'])
      .order('created_at', { ascending: false }),
  ]);
  const tables = (tRes.data as DiningTable[]) || [];
  const snapshotRows = (oRes.data as ActiveOrderSnapshotRow[] | null) || [];
  // Do not broaden public.users RLS just to show occupied-table ownership.
  // Reuse a narrowly scoped label snapshot only while the active order/cashier
  // identity set is unchanged, and refresh it after a very short TTL.
  const operatorLabels = await getOperatorLabels(branchId, snapshotRows);
  const operatorByOrder = new Map(operatorLabels.map((row) => [row.order_id, row]));
  const watchedOrderIds = snapshotRows.map((order) => order.id);

  let orderItems = snapshotRows.flatMap((order) => order.order_items || []);
  let kitchenSends = snapshotRows.flatMap((order) => order.order_kitchen_sends || []);
  const effectiveOrderIds = new Set(
    orderItems
      .filter((item) => Number(item.quantity || 0) > 0)
      .map((item) => item.order_id),
  );

  const orders = snapshotRows
    .filter((order) => effectiveOrderIds.has(order.id))
    .map((order) => {
      const { order_items: _orderItems, order_kitchen_sends: _kitchenSends, ...baseOrder } = order;
      void _orderItems;
      void _kitchenSends;
      const label = operatorByOrder.get(order.id);
      if (!label?.cashier_id) return baseOrder as Order;
      return {
        ...baseOrder,
        cashier: {
          id: label.cashier_id,
          full_name: label.operator_name,
          email: null,
        },
      } satisfies Order;
    });

  orderItems = orderItems.filter((item) => effectiveOrderIds.has(item.order_id));
  kitchenSends = kitchenSends.filter((send) => effectiveOrderIds.has(send.order_id));

  return { orders, tables, orderItems, kitchenSends, watchedOrderIds };
}

export async function fetchOrderForWorkspace(orderId: string): Promise<{ order: Order | null; items: OrderItem[]; products: Product[] }> {
  // Opening an order is a server-authorized operation. Branch visibility alone
  // is intentionally not enough because the floor plan may show other users'
  // occupied tables without granting access to their operational workspace.
  const { data: accessData, error: accessError } = await supabase.rpc('authorize_pos_order_access', {
    p_order_id: orderId,
  });
  if (accessError) throw accessError;
  const access = (accessData as PosOrderAccessResult | null) || null;
  if (!access?.success) {
    throw new Error(access?.error || 'ORDER_OPERATOR_REQUIRED');
  }

  const { data: o, error: orderError } = await supabase.from('orders').select('*').eq('id', orderId).maybeSingle();
  if (orderError) throw orderError;
  const order = (o as Order | null) || null;
  if (!order) return { order: null, items: [], products: [] };

  const { data: items, error: itemsError } = await supabase.from('order_items').select('*').eq('order_id', orderId);
  if (itemsError) throw itemsError;
  const itemRows = (items as OrderItem[]) || [];
  const ids = itemRows.map((i) => i.product_id).filter(Boolean) as string[];
  let products: Product[] = [];
  if (ids.length > 0) {
    const { data: prods, error: productsError } = await supabase.from('products').select('*').in('id', ids).eq('branch_id', order.branch_id);
    if (productsError) throw productsError;
    products = (prods as Product[]) || [];
  }
  return { order, items: itemRows, products };
}

export async function resolveMyActiveTableOrder(tableId: string): Promise<MyActiveTableOrderResolution> {
  const { data, error } = await supabase.rpc('resolve_my_active_table_order', { p_table_id: tableId });
  if (error) return { success: false, error: error.message, resumable: false };
  return (data as MyActiveTableOrderResolution | null) || { success: false, error: 'TABLE_BUSY', resumable: false };
}

export async function fetchBranches(): Promise<Branch[]> {
  const { data } = await supabase.from('branches').select('*').eq('is_active', true).order('name');
  return (data as Branch[]) || [];
}

export async function fetchCustomers(branchId: string): Promise<Customer[]> {
  let q = supabase.from('customers').select('*');
  if (branchId) q = q.eq('branch_id', branchId);
  const { data } = await q.order('name');
  return (data as Customer[]) || [];
}

export async function fetchActiveShift(branchId: string): Promise<{ id: string; expected: number; opened_at: string; opening_amount: number } | null> {
  const { data } = await posApi.getActiveShift({ p_branch_id: branchId });
  const res = data as unknown as { success?: boolean; open?: boolean; shift?: { id: string; expected: number; opened_at: string; opening_amount: number } } | null;
  return res?.open ? (res.shift ?? null) : null;
}
