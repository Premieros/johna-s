import { pos as posApi, supabase, type SplitTenderInput } from '@/api';
import { enqueueOfflineSale, type OfflineSaleQueueItem } from '@/core/offline/offlineStorage';
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
  employee_credit?: boolean;
  employee_id?: string;
  employee_customer_id?: string;
  credit_amount?: number;
};

type OwnedOfflineSaleQueueItem = Omit<OfflineSaleQueueItem, 'status' | 'retry_count'> & {
  created_by_user_id: string;
};

let armedSplitTender: SplitTenderInput[] | null = null;
let armedSplitTenderAt = 0;
const SPLIT_TENDER_ARM_TTL_MS = 15_000;

let armedEmployeeCreditId: string | null = null;
let armedEmployeeCreditAt = 0;
const EMPLOYEE_CREDIT_ARM_TTL_MS = 15_000;

export function armSplitTender(payments: SplitTenderInput[]): void {
  armedSplitTender = payments
    .filter((payment) => Number(payment.amount) > 0)
    .map((payment) => ({ payment_method: payment.payment_method, amount: Number(payment.amount) }));
  armedSplitTenderAt = Date.now();
  clearArmedEmployeeCredit();
}

export function clearArmedSplitTender(): void {
  armedSplitTender = null;
  armedSplitTenderAt = 0;
}

export function armEmployeeCredit(employeeId: string): void {
  armedEmployeeCreditId = employeeId || null;
  armedEmployeeCreditAt = Date.now();
  clearArmedSplitTender();
}

export function clearArmedEmployeeCredit(): void {
  armedEmployeeCreditId = null;
  armedEmployeeCreditAt = 0;
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

function consumeArmedEmployeeCredit(): string | null {
  if (!armedEmployeeCreditId || Date.now() - armedEmployeeCreditAt > EMPLOYEE_CREDIT_ARM_TTL_MS) {
    clearArmedEmployeeCredit();
    return null;
  }
  const employeeId = armedEmployeeCreditId;
  clearArmedEmployeeCredit();
  return employeeId;
}

function createOfflineToken(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return randomUuid;
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
}

async function queueOfflineSale(p: ProcessSalePayload): Promise<string> {
  if (!p.p_shift_id) throw new Error('SHIFT_REQUIRED_OFFLINE');

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const originatingUserId = sessionData.session?.user?.id || null;
  if (sessionError || !originatingUserId) throw new Error('AUTH_REQUIRED_OFFLINE');

  const id = `offline_sale_${createOfflineToken()}`;
  const queuedSale: OwnedOfflineSaleQueueItem = {
    id,
    client_id: id,
    created_by_user_id: originatingUserId,
    invoice_number: p.p_invoice_number,
    created_at: new Date().toISOString(),
    payload: p as unknown as Record<string, unknown>,
  };
  await enqueueOfflineSale(queuedSale);
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
  const employeeCreditId = consumeArmedEmployeeCredit();

  if ((splitPayments || employeeCreditId) && typeof navigator !== 'undefined' && !navigator.onLine) {
    return {
      result: null,
      error: employeeCreditId
        ? 'Employee credit requires an online connection.'
        : 'Split payment requires an online connection.',
    };
  }

  if (!splitPayments && !employeeCreditId && typeof navigator !== 'undefined' && !navigator.onLine) {
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
      return {
        result: null,
        error: err instanceof Error ? err.message : 'Could not save the offline sale safely.',
      };
    }
  }

  const resolvedShift = await resolveSharedBranchShift(p);
  if (!resolvedShift.payload) return { result: null, error: resolvedShift.error || 'SHIFT_REQUIRED' };
  const settlementPayload = resolvedShift.payload;

  if (employeeCreditId) {
    try {
      const {
        p_paid_amount: _paidAmount,
        p_payment_method: _paymentMethod,
        p_customer_id: _customerId,
        ...employeeBase
      } = settlementPayload;
      void _paidAmount;
      void _paymentMethod;
      void _customerId;
      const { data, error } = await posApi.processEmployeeCreditSale({
        ...employeeBase,
        p_employee_id: employeeCreditId,
      });
      const result = data as ProcessSaleResult | null;
      if (!error && result?.success) return { result, error: null };
      return { result, error: error?.message || result?.detail || result?.error || 'Employee credit sale failed' };
    } catch (err) {
      // Never retry or queue an ambiguous employee-credit request. The server may
      // have committed it already and a retry could create a second receivable.
      return { result: null, error: err instanceof Error ? err.message : 'Network error while processing employee credit' };
    }
  }

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

    const result = data as RpcResult | null;
    return { result, error: error?.message || result?.detail || result?.error || 'Sale processing failed' };
  } catch (err) {
    return { result: null, error: err instanceof Error ? err.message : 'Network error while processing sale' };
  }
}

export async function processSplitSaleForOrder(p: ProcessSplitSalePayload): Promise<{ result: (RpcResult & { split?: boolean; payment_count?: number }) | null; error: string | null }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { result: null, error: 'Split payment requires an online connection.' };
  }

  try {
    const { data, error } = await posApi.processSaleSplit(p);
    const result = data as (RpcResult & { split?: boolean; payment_count?: number }) | null;
    if (!error && result?.success) return { result, error: null };
    return { result, error: error?.message || result?.detail || result?.error || 'Split sale processing failed' };
  } catch (err) {
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
