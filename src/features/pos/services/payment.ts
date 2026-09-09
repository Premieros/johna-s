import { pos as posApi, supabase, type SplitTenderInput } from '@/api';
import { enqueueOfflineSale } from '@/core/offline/offlineStorage';
import type { RpcResult, OrderType } from '@/lib/types';
import type { ItemPayload } from '../utils/cart';

export interface ProcessSalePayload {
  p_invoice_number: string;
  p_branch_id: string;
  p_shift_id: string | null;
  p_warehouse_id: string | null;
  p_customer_id: string | null;
  p_salesperson_id: string | null;
  p_subtotal: number;
  p_discount_amount: number;
  p_discount_type: 'percent' | 'amount';
  p_tax_amount: number;
  p_bonus_amount: number;
  p_total: number;
  p_paid_amount: number;
  p_payment_method: string;
  p_status: string;
  p_items: ItemPayload[];
  p_order_type: OrderType;
  p_table_id: string | null;
  p_order_id: string | null;
  p_guest_count: number | null;
}

export interface ProcessSplitSalePayload extends Omit<ProcessSalePayload, 'p_paid_amount' | 'p_payment_method'> {
  p_payments: SplitTenderInput[];
}

export type ProcessSaleResult = RpcResult & {
  offline?: boolean;
  pending_sync?: boolean;
};

let armedSplitTender: SplitTenderInput[] | null = null;
let armedSplitTenderAt = 0;
const SPLIT_TENDER_ARM_TTL_MS = 15_000;

export function armSplitTender(payments: SplitTenderInput[]): void {
  armedSplitTender = payments
    .filter((payment) => Number(payment.amount) > 0)
    .map((payment) => ({ payment_method: payment.payment_method, amount: Number(payment.amount) }));
  armedSplitTenderAt = Date.now();
}

export function clearArmedSplitTender(): void {
  armedSplitTender = null;
  armedSplitTenderAt = 0;
}

function consumeArmedSplitTender(): SplitTenderInput[] | null {
  if (!armedSplitTender || Date.now() - armedSplitTenderAt > SPLIT_TENDER_ARM_TTL_MS) {
    clearArmedSplitTender();
    return null;
  }
  const payments = armedSplitTender;
  clearArmedSplitTender();
  return payments;
}

function createOfflineToken(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return randomUuid;
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
}

async function queueOfflineSale(p: ProcessSalePayload): Promise<string> {
  if (!p.p_shift_id) throw new Error('SHIFT_REQUIRED_OFFLINE');
  const id = `offline_sale_${createOfflineToken()}`;
  await enqueueOfflineSale({
    id,
    client_id: id,
    invoice_number: p.p_invoice_number,
    created_at: new Date().toISOString(),
    payload: p as unknown as Record<string, unknown>,
  });
  return id;
}

async function resolveSharedBranchShift(p: ProcessSalePayload): Promise<{ payload: ProcessSalePayload | null; error: string | null }> {
  if (p.p_shift_id) return { payload: p, error: null };

  try {
    const { data, error } = await posApi.getActiveShift({ p_branch_id: p.p_branch_id });
    if (error) return { payload: null, error: error.message || 'Could not verify active shift' };

    const result = data as unknown as { open?: boolean; shift?: { id?: string | null } | null } | null;
    const shiftId = result?.open ? result.shift?.id || null : null;
    if (!shiftId) return { payload: null, error: 'SHIFT_REQUIRED' };

    return { payload: { ...p, p_shift_id: shiftId }, error: null };
  } catch (err) {
    return { payload: null, error: err instanceof Error ? err.message : 'Could not verify active shift' };
  }
}

export async function processSaleForOrder(p: ProcessSalePayload): Promise<{ result: ProcessSaleResult | null; error: string | null }> {
  const splitPayments = consumeArmedSplitTender();

  // Split tender is intentionally online-only. It must never degrade into an
  // offline queue because that could produce partial financial truth.
  if (splitPayments && typeof navigator !== 'undefined' && !navigator.onLine) {
    return { result: null, error: 'Split payment requires an online connection.' };
  }

  // Explicit offline sales are accepted only into the authoritative IndexedDB
  // outbox. They are pending reconciliation, not a server-confirmed payment.
  if (!splitPayments && typeof navigator !== 'undefined' && !navigator.onLine) {
    try {
      const queuedId = await queueOfflineSale(p);
      return {
        result: {
          success: true,
          offline: true,
          pending_sync: true,
          sale_id: queuedId,
          order_id: p.p_order_id || undefined,
        },
        error: null,
      };
    } catch (err) {
      // If the durable local outbox cannot persist the sale, fail closed. A
      // volatile/in-memory success would be indistinguishable from data loss.
      return {
        result: null,
        error: err instanceof Error ? err.message : 'Could not save the offline sale safely.',
      };
    }
  }

  // Shared shifts are branch-level operational state, not cashier-only state.
  // Older callers may omit p_shift_id for non-cashier users, so resolve the
  // authoritative open branch shift before either normal or split settlement.
  const resolvedShift = await resolveSharedBranchShift(p);
  if (!resolvedShift.payload) return { result: null, error: resolvedShift.error || 'SHIFT_REQUIRED' };
  const settlementPayload = resolvedShift.payload;

  if (splitPayments) {
    const { p_paid_amount: _paidAmount, p_payment_method: _paymentMethod, ...splitBase } = settlementPayload;
    void _paidAmount;
    void _paymentMethod;
    return processSplitSaleForOrder({ ...splitBase, p_payments: splitPayments });
  }

  try {
    const { data, error } = await posApi.processSale(settlementPayload);
    if (!error && (data as { success?: boolean })?.success) {
      return { result: data as RpcResult, error: null };
    }

    // A server rejection (approval, stock, subscription, validation, etc.) is
    // authoritative and must never be converted into a successful offline sale.
    const result = data as RpcResult | null;
    return { result, error: error?.message || result?.detail || result?.error || 'Sale processing failed' };
  } catch (err) {
    // Do not enqueue after an ambiguous online failure: the server may have
    // committed before the response was lost, which would create a duplicate.
    return { result: null, error: err instanceof Error ? err.message : 'Network error while processing sale' };
  }
}

export async function processSplitSaleForOrder(p: ProcessSplitSalePayload): Promise<{ result: (RpcResult & { split?: boolean; payment_count?: number }) | null; error: string | null }> {
  // Do not queue split tender offline until the offline outbox has a dedicated
  // idempotent split contract. A partial local recreation would be financially unsafe.
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { result: null, error: 'Split payment requires an online connection.' };
  }

  try {
    const { data, error } = await posApi.processSaleSplit(p);
    const result = data as (RpcResult & { split?: boolean; payment_count?: number }) | null;
    if (!error && result?.success) return { result, error: null };

    // A server rejection from process_sale_split is authoritative too; never
    // degrade it into the normal offline queue or a second financial attempt.
    return { result, error: error?.message || result?.detail || result?.error || 'Split sale processing failed' };
  } catch (err) {
    // The server may have committed before the network response disappeared.
    return { result: null, error: err instanceof Error ? err.message : 'Network error while processing split sale' };
  }
}

export async function nextInvoiceNumber(): Promise<string> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `INV-OFF-${dateStr}-${createOfflineToken()}`;
  }

  try {
    const { data, error } = await posApi.nextDocumentNumber({ p_type: 'sale' });
    const number = !error && data?.success ? (data as { number?: string }).number : null;
    if (number) return number;
    throw new Error(error?.message || (data as RpcResult | null)?.detail || (data as RpcResult | null)?.error || 'Could not allocate sale invoice number');
  } catch (err) {
    // Online numbering is server-authoritative. Failing closed prevents a
    // second client-side numbering source from producing financial drift.
    throw err instanceof Error ? err : new Error('Could not allocate sale invoice number');
  }
}

export async function fetchBranchWarehouseId(branchId: string, orderId?: string | null): Promise<string | null> {
  try {
    if (orderId) {
      const { data: order } = await supabase
        .from('orders')
        .select('inventory_warehouse_id')
        .eq('id', orderId)
        .eq('branch_id', branchId)
        .maybeSingle();
      const orderWarehouseId = (order as { inventory_warehouse_id?: string | null } | null)?.inventory_warehouse_id;
      if (orderWarehouseId) return orderWarehouseId;
    }

    const { data } = await supabase
      .from('warehouses')
      .select('id,is_default,created_at')
      .eq('branch_id', branchId)
      .eq('is_active', true)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });
    const rows = (data as { id: string }[] | null) || [];
    return rows.length > 0 ? rows[0].id : null;
  } catch {
    return null;
  }
}
