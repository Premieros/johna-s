import { supabase } from '@/lib/supabase';
import type { ApiError, ApiResult, SaleItemInput } from '../types';
import type { RpcResult, Shift, OrderType } from '@/lib/types';
import { rpc } from '../rpc';

export interface SplitTenderInput {
  payment_method: 'cash' | 'card' | 'transfer';
  amount: number;
}

export type PosStructuralAction = 'split_order' | 'merge_order' | 'transfer_order';

export interface PosStructuralActionResult extends RpcResult {
  action?: PosStructuralAction;
  request_id?: string;
  status?: string;
  source_order_id?: string;
  target_order_id?: string;
  target_table_id?: string;
  inventory_changed?: boolean;
  kds_changed?: boolean;
}

export const pos = {
  async getActiveShift(p: { p_branch_id: string }): ApiResult<Shift> {
    try {
      const res = await rpc<Shift>('get_active_shift', p);
      if (!res.error && res.data) return res;
    } catch {
      // Fallback below.
    }

    try {
      const { data, error } = await supabase
        .from('shifts')
        .select('*')
        .eq('branch_id', p.p_branch_id)
        .eq('status', 'open')
        .order('opened_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) return { data: null, error: error as unknown as ApiError };
      if (!data) return { data: null, error: null };

      return {
        data: {
          open: true,
          shift: {
            id: data.id,
            expected: Number(data.expected_amount) || Number(data.opening_amount) || 0,
            opened_at: data.opened_at,
            opening_amount: Number(data.opening_amount) || 0,
          },
        } as unknown as Shift,
        error: null,
      };
    } catch (err) {
      return { data: null, error: err as unknown as ApiError };
    }
  },

  sendToKitchen(p: { p_order_id: string; p_sent_by?: string | null }): ApiResult<RpcResult & { order_id?: string; sent?: unknown[]; items_sent_count?: number; all_sent?: boolean }> { return rpc('send_to_kitchen', p); },
  nextDocumentNumber(p: { p_type: string }): ApiResult<RpcResult> { return rpc('next_sale_document_number', p); },
  transferOrderItemToTable(p: { p_order_id: string; p_order_item_id: string; p_target_table_id: string }): ApiResult<RpcResult & { target_order_id?: string; target_order_number?: string; source_order_empty?: boolean; inventory_changed?: boolean; kds_changed?: boolean }> {
    return rpc('transfer_order_item_to_table', p);
  },
  performOrderAction(p: { p_action_type: PosStructuralAction; p_order_id: string; p_payload: Record<string, unknown>; p_reason: string }): ApiResult<PosStructuralActionResult> {
    return rpc('perform_pos_order_action', p);
  },

  async processSale(p: {
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
    p_items: SaleItemInput[];
    p_order_type?: OrderType;
    p_table_id?: string | null;
    p_order_id?: string | null;
    p_guest_count?: number | null;
  }): ApiResult<RpcResult> {
    return rpc<RpcResult>('process_sale', p);
  },

  async processSaleSplit(p: {
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
    p_payments: SplitTenderInput[];
    p_status: string;
    p_items: SaleItemInput[];
    p_order_type?: OrderType;
    p_table_id?: string | null;
    p_order_id?: string | null;
    p_guest_count?: number | null;
  }): ApiResult<RpcResult & { split?: boolean; payment_count?: number }> {
    // Split payment keeps process_sale_split as the only authoritative write.
    // The RPC itself delegates inventory to _process_sale_core exactly once.
    return rpc('process_sale_split', p);
  },
};