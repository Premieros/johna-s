import { supabase } from './supabase';

export type MobileOrderAction = 'split_order' | 'merge_order' | 'transfer_order';

export type MobileOrderActionResult = {
  success?: boolean;
  error?: string;
  detail?: string;
  action?: MobileOrderAction;
  request_id?: string;
  status?: string;
  source_order_id?: string;
  target_order_id?: string;
  target_table_id?: string;
  inventory_changed?: boolean;
  kds_changed?: boolean;
};

export type MobileActiveShift = {
  id: string;
  openedAt: string | null;
  openingAmount: number;
  expectedAmount: number;
};

export type MobileMyShiftSummary = {
  shift: MobileActiveShift | null;
  orderCount: number;
  openOrderCount: number;
  totalOrderValue: number;
};

const requireSessionUserId = async (): Promise<string> => {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user?.id;
  if (!userId) throw new Error('SESSION_REQUIRED');
  return userId;
};

export async function getActiveShift(branchId: string): Promise<MobileActiveShift | null> {
  const rpcResult = await supabase.rpc('get_active_shift', { p_branch_id: branchId });
  if (!rpcResult.error && rpcResult.data) {
    const payload = rpcResult.data as {
      open?: boolean;
      shift?: {
        id?: string;
        opened_at?: string | null;
        opening_amount?: number | string | null;
        expected?: number | string | null;
      } | null;
    };
    if (payload.open && payload.shift?.id) {
      return {
        id: payload.shift.id,
        openedAt: payload.shift.opened_at || null,
        openingAmount: Number(payload.shift.opening_amount || 0),
        expectedAmount: Number(payload.shift.expected || payload.shift.opening_amount || 0),
      };
    }
    if (payload.open === false) return null;
  }

  const { data, error } = await supabase
    .from('shifts')
    .select('id,opened_at,opening_amount,expected_amount')
    .eq('branch_id', branchId)
    .eq('status', 'open')
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id,
    openedAt: data.opened_at || null,
    openingAmount: Number(data.opening_amount || 0),
    expectedAmount: Number(data.expected_amount || data.opening_amount || 0),
  };
}

export async function getMyShiftSummary(branchId: string): Promise<MobileMyShiftSummary> {
  const [userId, shift] = await Promise.all([
    requireSessionUserId(),
    getActiveShift(branchId),
  ]);

  let query = supabase
    .from('orders')
    .select('id,total,status,shift_id')
    .eq('branch_id', branchId)
    .eq('cashier_id', userId);

  if (shift?.id) query = query.eq('shift_id', shift.id);
  else query = query.in('status', ['open', 'held']);

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data || []) as Array<{ total?: number | string | null; status?: string | null }>;
  return {
    shift,
    orderCount: rows.length,
    openOrderCount: rows.filter((row) => row.status === 'open' || row.status === 'held').length,
    totalOrderValue: rows.reduce((sum, row) => sum + Number(row.total || 0), 0),
  };
}

export async function performPosOrderAction(
  action: MobileOrderAction,
  orderId: string,
  payload: Record<string, unknown>,
  reason: string,
): Promise<MobileOrderActionResult> {
  const { data, error } = await supabase.rpc('perform_pos_order_action', {
    p_action_type: action,
    p_order_id: orderId,
    p_payload: payload,
    p_reason: reason,
  });
  if (error) throw error;

  const result = (data || {}) as MobileOrderActionResult;
  if (!result.success) throw new Error(result.detail || result.error || 'ORDER_ACTION_FAILED');
  return result;
}
