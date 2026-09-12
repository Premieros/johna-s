import type { KitchenSendItem, KitchenSendResult } from '../types';
import { rpc } from '@/api/rpc';
import { supabase } from '@/api';
import { enqueueCloudKitchenPrintJobs } from './cloudPrint';
import { printKitchenStationsLocally, suppressNextKitchenBrowserPopup } from './localPrintAgent';

// In-flight locks prevent rapid duplicate clicks. The server remains the
// authoritative idempotency and inventory-deduction boundary.
const activeSendLocks = new Set<string>();

/**
 * The automatic kitchen ticket currently consumes product_name from the
 * authoritative send_to_kitchen snapshot. Preserve the base name but append
 * modifiers and the item note so the browser fallback cannot silently lose
 * cooking instructions that are already present in the KDS snapshot.
 */
function withKitchenInstructions(item: KitchenSendItem): KitchenSendItem {
  const parts: string[] = [];
  for (const modifier of item.modifiers || []) {
    const name = modifier.option_name || modifier.option_name_en;
    if (name) parts.push(name);
  }
  if (item.notes?.trim()) parts.push(item.notes.trim());
  if (parts.length === 0) return item;

  const baseName = item.product_name || '—';
  return {
    ...item,
    product_name: `${baseName} • ${parts.join(' • ')}`,
  };
}

/**
 * Send the persisted order to KDS.
 *
 * Hard rules:
 * - The client never mutates inventory directly.
 * - The server deducts only the positive kitchen delta and decides station_code.
 * - Printing is a side effect after the authoritative kitchen mutation. Cloud
 *   retries therefore replay PRINT ONLY and can never deduct inventory again.
 * - Once any cloud station job is accepted, the generic browser ticket is
 *   suppressed so a successful station cannot be duplicated by fallback.
 * - Until the cloud migration is deployed, the proven local/legacy print path
 *   remains the compatibility fallback.
 */
export async function sendOrderToKitchen(p: {
  p_order_id: string;
  p_sent_by?: string | null;
}): Promise<KitchenSendResult> {
  const orderId = p.p_order_id;
  if (!orderId) return { success: false, error: 'NO_ORDER_ID', detail: 'Order ID is required' };

  if (activeSendLocks.has(orderId)) {
    return { success: false, error: 'SEND_IN_PROGRESS', detail: 'Kitchen send is already in progress for this order' };
  }

  activeSendLocks.add(orderId);
  try {
    const rpcRes = await rpc<{
      success: boolean;
      error?: string;
      detail?: string;
      order_id?: string;
      order_number?: string | null;
      table_name?: string | null;
      order_type?: string | null;
      guest_count?: number | null;
      warehouse_id?: string | null;
      sent?: KitchenSendItem[];
      items_sent_count?: number;
      items_processed?: number;
      all_sent?: boolean;
      inventory_deducted?: boolean;
      product_id?: string | null;
      product_name?: string | null;
    }>('send_to_kitchen', {
      p_order_id: orderId,
      p_sent_by: p.p_sent_by || null,
    });

    if (rpcRes.error) {
      return {
        success: false,
        error: 'KITCHEN_SEND_FAILED',
        detail: rpcRes.error.message,
      };
    }

    const result = rpcRes.data;
    if (!result?.success) {
      return {
        success: false,
        error: result?.error || 'KITCHEN_SEND_FAILED',
        detail: result?.detail || result?.error || 'Kitchen send failed',
      };
    }

    const rawSentItems = result.sent || [];
    if (rawSentItems.length > 0 && typeof window !== 'undefined') {
      const context = {
        orderNumber: result.order_number || result.order_id || orderId,
        tableName: result.table_name || null,
        orderType: result.order_type || null,
        guestCount: result.guest_count || null,
        isAr: document.documentElement.dir === 'rtl' || document.documentElement.lang?.startsWith('ar'),
      };

      let cloudQueuedStations = 0;
      try {
        const { data: orderRow } = await supabase
          .from('orders')
          .select('branch_id')
          .eq('id', orderId)
          .maybeSingle();
        const branchId = (orderRow as { branch_id?: string } | null)?.branch_id || '';
        if (branchId) {
          const cloud = await enqueueCloudKitchenPrintJobs({
            branchId,
            items: rawSentItems,
            context,
          });
          cloudQueuedStations = cloud.queuedStations.length;
          if (cloudQueuedStations > 0) suppressNextKitchenBrowserPopup();
        }
      } catch (error) {
        console.warn('[cloud-print] kitchen queue unavailable; using compatibility print path', error);
      }

      if (cloudQueuedStations === 0) {
        const localPrinted = await printKitchenStationsLocally(rawSentItems, context);
        if (localPrinted) suppressNextKitchenBrowserPopup();
      }
    }

    const sentItems = rawSentItems.map(withKitchenInstructions);
    return {
      success: true,
      order_id: result.order_id || orderId,
      order_number: result.order_number || null,
      table_name: result.table_name || null,
      order_type: result.order_type || null,
      guest_count: result.guest_count || null,
      sent: sentItems,
      items_sent_count: result.items_sent_count ?? result.items_processed ?? sentItems.length,
      all_sent: result.all_sent ?? true,
    };
  } catch (err) {
    return {
      success: false,
      error: 'KITCHEN_SEND_FAILED',
      detail: err instanceof Error ? err.message : 'Unknown error during kitchen send',
    };
  } finally {
    activeSendLocks.delete(orderId);
  }
}

/**
 * Legacy compatibility entry point. Reversal is server-only; never perform a
 * direct client inventory fallback. In the current architecture KDS does not
 * consume stock, so normal order cancellation does not need inventory reversal.
 */
export async function reverseOrderKitchenConsumption(
  orderId: string,
  reason?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await rpc<{ success: boolean; error?: string; detail?: string }>('reverse_order_kitchen_consumption', {
      p_order_id: orderId,
      p_reason: reason || null,
    });
    if (res.error) return { success: false, error: res.error.message };
    if (res.data?.success) return { success: true };
    return { success: false, error: res.data?.detail || res.data?.error || 'KITCHEN_REVERSAL_NOT_AVAILABLE' };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'KITCHEN_REVERSAL_NOT_AVAILABLE' };
  }
}
