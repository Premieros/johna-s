import type { ApiResult } from '../types';
import type { RpcResult, OrderType, OrderServiceDetails } from '@/lib/types';
import { clearPendingServiceDetails, getPendingServiceDetails } from '@/lib/posServiceDetails';
import { rpc } from '../rpc';

const isServiceOrderType = (orderType?: OrderType): orderType is 'delivery' | 'drive_thru' =>
  orderType === 'delivery' || orderType === 'drive_thru';

export const floorPlan = {
  async createOrder(p: {
    p_branch_id: string;
    p_order_type?: OrderType;
    p_table_id?: string | null;
    p_customer_id?: string | null;
    p_guest_count?: number | null;
    p_notes?: string | null;
    p_items: {
      product_id: string;
      unit_name: string;
      quantity: number;
      unit_price: number;
      discount_amount: number;
      bonus_quantity: number;
      total: number;
      notes?: string | null;
    }[];
    p_subtotal?: number;
    p_discount_amount?: number;
    p_discount_type?: 'percent' | 'amount';
    p_tax_amount?: number;
    p_total?: number;
    p_cashier_id?: string | null;
  }): ApiResult<RpcResult & { order_id?: string; order_number?: string }> {
    // Keep the canonical create_order boundary for normal POS flows. Service
    // orders use a narrow wrapper that delegates to create_order and persists
    // their structured metadata atomically in the same database transaction.
    if (isServiceOrderType(p.p_order_type)) {
      const serviceDetails: OrderServiceDetails = getPendingServiceDetails() || {};
      return rpc<RpcResult & { order_id?: string; order_number?: string }>('create_service_order', {
        ...p,
        p_service_details: serviceDetails,
      }).then((result) => {
        if (!result.error && (result.data as RpcResult | null)?.success) clearPendingServiceDetails();
        return result;
      });
    }
    return rpc<RpcResult & { order_id?: string; order_number?: string }>('create_order', p);
  },

  async setOrderStatus(p: { p_order_id: string; p_status: string; p_notes?: string | null }): ApiResult<RpcResult> {
    return rpc<RpcResult>('set_order_status', p);
  },

  async updateOrder(p: {
    p_order_id: string;
    p_order_type?: OrderType;
    p_table_id?: string | null;
    p_customer_id?: string | null;
    p_guest_count?: number | null;
    p_notes?: string | null;
    p_items: {
      product_id: string;
      unit_name: string;
      quantity: number;
      unit_price: number;
      discount_amount: number;
      bonus_quantity: number;
      total: number;
      notes?: string | null;
    }[];
    p_subtotal?: number;
    p_discount_amount?: number;
    p_discount_type?: 'percent' | 'amount';
    p_tax_amount?: number;
    p_total?: number;
    p_status?: 'open' | 'held';
  }): ApiResult<RpcResult> {
    if (isServiceOrderType(p.p_order_type)) {
      // A resumed order normally has no in-memory draft. Passing NULL tells the
      // server wrapper to preserve and revalidate the service_details already
      // stored on that order instead of replacing them with an empty object.
      return rpc<RpcResult>('update_service_order', {
        ...p,
        p_service_details: getPendingServiceDetails(),
      });
    }
    return rpc<RpcResult>('update_order', p);
  },

  async setTableStatus(p: { p_table_id: string; p_status: string }): ApiResult<RpcResult> {
    return rpc<RpcResult>('set_table_status', p);
  },

  async detachOrder(p: { p_order_id: string }): ApiResult<RpcResult> {
    return rpc<RpcResult>('detach_order', p);
  },

  async transferOrderOperator(p: {
    p_order_id: string;
    p_target_user_id: string;
  }): ApiResult<RpcResult & {
    order_id?: string;
    branch_id?: string;
    table_id?: string | null;
    from_cashier_id?: string;
    to_cashier_id?: string;
    transferred_by?: string;
  }> {
    return rpc('transfer_order_operator', p);
  },
};
