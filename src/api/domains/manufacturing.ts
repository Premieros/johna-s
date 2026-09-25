import type { ApiResult } from '../types';
import type { RpcResult } from '@/lib/types';
import { rpc } from '../rpc';

function failClosedResult(err: unknown, fallback: string): ApiResult<RpcResult> {
  return {
    data: { success: false, error: err instanceof Error ? err.message : fallback },
    error: null,
  };
}

/**
 * Legacy production-order API.
 *
 * The production-order UI is being retired. Until the remaining application
 * surface is removed, every legacy action is RPC-authoritative and fail-closed.
 * Client-side table mutations are intentionally forbidden here: falling back to
 * direct production_orders writes can bypass the transaction/inventory/accounting
 * authority owned by the database RPCs.
 */
export const manufacturing = {
  async createOrder(p: {
    p_product_id: string;
    p_branch_id: string;
    p_warehouse_id: string | null;
    p_quantity: number;
    p_batch_number: string | null;
    p_planned_at: string | null;
    p_notes: string | null;
  }): ApiResult<RpcResult> {
    try {
      return await rpc<RpcResult>('create_production_order', p);
    } catch (err) {
      return failClosedResult(err, 'Failed to create production order');
    }
  },

  async startOrder(p: { p_order_id: string }): ApiResult<RpcResult> {
    try {
      return await rpc<RpcResult>('start_production_order', p);
    } catch (err) {
      return failClosedResult(err, 'Failed to start production order');
    }
  },

  async completeOrder(p: {
    p_order_id: string;
    p_waste: { raw_material_id: string; quantity: number; reason: string | null }[] | null;
  }): ApiResult<RpcResult> {
    try {
      return await rpc<RpcResult>('complete_production_order', p);
    } catch (err) {
      return failClosedResult(err, 'Failed to complete production order');
    }
  },

  async cancelOrder(p: { p_order_id: string; p_reason: string | null }): ApiResult<RpcResult> {
    try {
      return await rpc<RpcResult>('cancel_production_order', p);
    } catch (err) {
      return failClosedResult(err, 'Failed to cancel production order');
    }
  },
};
