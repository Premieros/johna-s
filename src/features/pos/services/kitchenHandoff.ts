import type { KitchenSendItem, KitchenSendResult, KitchenStationDispatchSummary } from '../types';
import { rpc } from '@/api/rpc';
import { supabase } from '@/api';
import { sendOrderToKitchen as sendLegacyOrderToKitchen } from './kitchen';
import { dispatchKitchenStations } from './kitchenDispatch';
import { groupKitchenItemsByStation } from './localPrintAgent';

// OFF in all current builds. A later, reviewed release must explicitly set
// VITE_KITCHEN_ATOMIC_PRINT_HANDOFF=true *after* the optional SQL RPC is installed.
// No database, printer, localStorage or account configuration can turn this on.
const optInSendingOrders = new Set<string>();

interface HandoffParams {
  p_order_id: string;
  p_sent_by?: string | null;
  p_branch_id?: string | null;
  p_is_ar: boolean;
}

interface HandoffRpcResult extends KitchenSendResult {
  branch_id?: string | null;
  items_processed?: number;
  print_queue_state?: 'queued' | 'client_fallback' | 'client_only' | 'not_needed';
  print_queue_jobs?: number;
}

function displayKitchenInstructions(item: KitchenSendItem): KitchenSendItem {
  const parts: string[] = [];
  for (const modifier of item.modifiers || []) {
    const name = modifier.option_name || modifier.option_name_en;
    if (name) parts.push(name);
  }
  if (item.notes?.trim()) parts.push(item.notes.trim());
  return parts.length > 0
    ? { ...item, product_name: (item.product_name || '—') + ' • ' + parts.join(' • ') }
    : item;
}

export function isKitchenHandoffOptedIn(branchId?: string | null): boolean {
  // A global opt-in alone is never enough: a controlled rollout must explicitly
  // name the branch, otherwise an enabled build would switch ALL active stores.
  if (import.meta.env.VITE_KITCHEN_ATOMIC_PRINT_HANDOFF !== 'true') return false;
  const branch = String(branchId || '').trim().toLowerCase();
  if (!branch) return false;
  return String(import.meta.env.VITE_KITCHEN_ATOMIC_PRINT_BRANCH_IDS || '')
    .split(',')
    .some((allowed) => allowed.trim().toLowerCase() === branch);
}

export async function sendOrderToKitchen(p: HandoffParams): Promise<KitchenSendResult> {
  const legacyParams = {
    p_order_id: p.p_order_id, p_sent_by: p.p_sent_by, p_branch_id: p.p_branch_id,
  };
  if (!isKitchenHandoffOptedIn(p.p_branch_id)) return sendLegacyOrderToKitchen(legacyParams);
  if (!p.p_order_id) return { success: false, error: 'NO_ORDER_ID', detail: 'Order ID is required' };
  if (optInSendingOrders.has(p.p_order_id)) {
    return { success: false, error: 'SEND_IN_PROGRESS', detail: 'Kitchen send is already in progress for this order' };
  }
  optInSendingOrders.add(p.p_order_id);
  try {
    const response = await rpc<HandoffRpcResult>('send_to_kitchen_with_print', {
      p_order_id: p.p_order_id, p_sent_by: p.p_sent_by || null, p_is_ar: p.p_is_ar,
    });
    if (response.error) {
      // Only a confirmed "RPC does not exist" permits the legacy send.
      // A timeout or disconnected response may already have committed a send.
      if (response.error.code === 'PGRST202' || response.error.code === '42883') {
        return await sendLegacyOrderToKitchen(legacyParams);
      }
      return { success: false, error: 'KITCHEN_SEND_FAILED', detail: response.error.message };
    }
    const result = response.data;
    if (!result?.success) {
      return { success: false, error: result?.error || 'KITCHEN_SEND_FAILED',
        detail: result?.detail || result?.error || 'Kitchen send failed' };
    }

    const rawItems = result.sent || [];
    let dispatch: KitchenStationDispatchSummary | undefined;
    if (rawItems.length > 0 && typeof window !== 'undefined') {
      let orderBranchId = result.branch_id || null;
      if (!orderBranchId) {
        const lookup = await supabase.from('orders').select('branch_id').eq('id', p.p_order_id).maybeSingle();
        if (!lookup.error) orderBranchId = lookup.data?.branch_id || null;
      }
      const groups = groupKitchenItemsByStation(rawItems);
      const stations = Object.keys(groups);
      const missing = rawItems.length - Object.values(groups).reduce((n, a) => n + a.length, 0);

      if (result.print_queue_state === 'queued') {
        // The server has already inserted every ticket. NEVER enqueue locally,
        // fall back to a physical printer, or open a browser print popup here.
        // If the acknowledgement is malformed, warn instead of risking paper duplication.
        const confirmed = Boolean(orderBranchId && result.branch_id === orderBranchId
          && p.p_is_ar && missing === 0 && stations.length > 0
          && Number(result.print_queue_jobs) === stations.length);
        dispatch = {
          status: confirmed ? 'complete' : 'failed',
          stations: stations.map((station) => ({
            station_code: station, item_count: groups[station].length,
            state: confirmed ? 'queued' : 'failed',
            ...(confirmed ? {} : { detail: 'SERVER_PRINT_ACK_UNCONFIRMED' }),
          })),
          failed_stations: confirmed ? [] : stations,
          missing_station_items: missing,
        };
        // The POS hook skips the automatic browser print explicitly.
        // Never hijack window.open: unrelated windows must keep working.
      } else if (orderBranchId && (
        result.print_queue_state === 'client_fallback' || result.print_queue_state === 'client_only'
      )) {
        dispatch = await dispatchKitchenStations({
          orderId: p.p_order_id, branchId: orderBranchId,
          allowLocalFallback: orderBranchId === p.p_branch_id,
          items: rawItems,
          context: {
            orderId: result.order_id || p.p_order_id,
            orderNumber: result.order_number || result.order_id || p.p_order_id,
            tableName: result.table_name || null,
            orderType: result.order_type || null,
            guestCount: result.guest_count || null,
            isAr: p.p_is_ar,
          },
        });
      } else {
        // Unexpected server status or missing saved branch. Never guess
        // whether paper already came out by sending a second print request.
        dispatch = {
          status: 'failed',
          stations: stations.map((station) => ({
            station_code: station, item_count: groups[station].length,
            state: 'failed', detail: 'SERVER_PRINT_STATE_UNKNOWN',
          })),
          failed_stations: stations, missing_station_items: missing,
        };
      }
    }
    const sent = rawItems.map(displayKitchenInstructions);
    return {
      success: true,
      order_id: result.order_id || p.p_order_id,
      order_number: result.order_number || null,
      table_name: result.table_name || null,
      order_type: result.order_type || null,
      guest_count: result.guest_count || null,
      sent,
      items_sent_count: result.items_sent_count ?? result.items_processed ?? sent.length,
      all_sent: result.all_sent ?? true,
      dispatch,
      // Any server-queued or unrecognized status may already have printed.
      // Only an explicit fallback/client-only response permits browser print.
      suppress_kitchen_browser_popup: !(
        result.print_queue_state === 'client_fallback' || result.print_queue_state === 'client_only'
      ),
    };
  } catch (error) {
    return { success: false, error: 'KITCHEN_SEND_FAILED',
      detail: error instanceof Error ? error.message : 'Unknown error during kitchen send' };
  } finally {
    optInSendingOrders.delete(p.p_order_id);
  }
}
