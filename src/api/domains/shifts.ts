import type { ApiResult } from '../types';
import type { RpcResult } from '@/lib/types';
import { rpc } from '../rpc';

/**
 * Shift mutations are intentionally server-authoritative.
 * Do not add direct table-write fallbacks here: open/close/force-close actions
 * must always pass the database permission, branch and approval checks.
 */
export const shifts = {
  open(p: { p_branch_id: string; p_opening_amount: number; p_notes: string | null }): ApiResult<RpcResult & { shift_id?: string }> {
    return rpc<RpcResult & { shift_id?: string }>('open_shift', p);
  },

  close(p: { p_shift_id: string; p_actual_amount: number; p_notes: string | null }): ApiResult<RpcResult> {
    return rpc<RpcResult>('close_shift', p);
  },

  dayClose(p: { p_branch_id: string; p_business_date: string }): ApiResult<RpcResult & { daily_close_id?: string; already_closed?: boolean }> {
    return rpc('day_close', p);
  },

  getClosingReport(p: { p_shift_id: string }): ApiResult<RpcResult & Record<string, unknown>> {
    return rpc('get_shift_closing_report', p);
  },

  closeWithOpenOrders(p: { p_shift_id: string; p_actual_amount: number; p_notes: string | null }): ApiResult<RpcResult & { open_orders_preserved?: boolean; open_order_count?: number; open_table_count?: number }> {
    return rpc<RpcResult & { open_orders_preserved?: boolean; open_order_count?: number; open_table_count?: number }>('close_shift_with_open_orders', p);
  },

  forceClose(p: { p_shift_id: string; p_actual_amount: number | null; p_reason: string | null }): ApiResult<RpcResult> {
    return rpc<RpcResult>('force_close_shift', p);
  },

  authorizeOpenDrawer(p: { p_shift_id: string; p_reason: string | null }): ApiResult<RpcResult & { authorized?: boolean; hardware_action_required?: boolean }> {
    return rpc<RpcResult & { authorized?: boolean; hardware_action_required?: boolean }>('authorize_open_drawer', p);
  },
};
