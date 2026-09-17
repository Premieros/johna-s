import { supabase } from '@/api';
import type { ItemPayload } from '../utils/cart';

export interface OrderSettlementPreview {
  success: boolean;
  error?: string;
  detail?: string;
  order_id?: string;
  branch_id?: string;
  warehouse_id?: string | null;
  items: ItemPayload[];
  subtotal: number;
  discount_amount: number;
  discount_type: 'amount';
  tax_amount: number;
  total: number;
  pending_quantity: number;
  unsent_quantity: number;
  has_payable_items: boolean;
}

export async function fetchOrderSettlementPreview(
  orderId: string,
): Promise<{ preview: OrderSettlementPreview | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('get_order_settlement_preview', {
      p_order_id: orderId,
    });
    if (error) return { preview: null, error: error.message };

    const raw = data as Partial<OrderSettlementPreview> | null;
    if (!raw?.success) {
      return {
        preview: null,
        error: raw?.detail || raw?.error || 'No sent items are ready for settlement.',
      };
    }

    return {
      preview: {
        success: true,
        order_id: raw.order_id,
        branch_id: raw.branch_id,
        warehouse_id: raw.warehouse_id ?? null,
        items: Array.isArray(raw.items) ? raw.items : [],
        subtotal: Number(raw.subtotal || 0),
        discount_amount: Number(raw.discount_amount || 0),
        discount_type: 'amount',
        tax_amount: Number(raw.tax_amount || 0),
        total: Number(raw.total || 0),
        pending_quantity: Number(raw.pending_quantity || 0),
        unsent_quantity: Number(raw.unsent_quantity || 0),
        has_payable_items: Boolean(raw.has_payable_items),
      },
      error: null,
    };
  } catch (error) {
    return {
      preview: null,
      error: error instanceof Error ? error.message : 'Could not load settlement preview.',
    };
  }
}
