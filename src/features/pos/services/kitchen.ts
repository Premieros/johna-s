import type { KitchenSendItem, KitchenSendResult } from '../types';
import { rpc } from '@/api/rpc';
import { enqueueCloudKitchenPrintJobs } from './cloudPrint';
import { groupKitchenItemsByStation, printKitchenStationsLocally, suppressNextKitchenBrowserPopup } from './localPrintAgent';

const activeSendLocks = new Set<string>();

function withKitchenInstructions(item: KitchenSendItem): KitchenSendItem {
  const parts: string[] = [];
  for (const modifier of item.modifiers || []) {
    const name = modifier.option_name || modifier.option_name_en;
    if (name) parts.push(name);
  }
  if (item.notes?.trim()) parts.push(item.notes.trim());
  if (parts.length === 0) return item;
  return { ...item, product_name: `${item.product_name || '—'} • ${parts.join(' • ')}` };
}

export async function sendOrderToKitchen(p: { p_order_id: string; p_sent_by?: string | null; p_branch_id?: string | null }): Promise<KitchenSendResult> {
  const orderId = p.p_order_id;
  if (!orderId) return { success: false, error: 'NO_ORDER_ID', detail: 'Order ID is required' };
  if (activeSendLocks.has(orderId)) return { success: false, error: 'SEND_IN_PROGRESS', detail: 'Kitchen send is already in progress for this order' };

  activeSendLocks.add(orderId);
  try {
    const rpcRes = await rpc<{
      success: boolean; error?: string; detail?: string; order_id?: string; order_number?: string | null;
      table_name?: string | null; order_type?: string | null; guest_count?: number | null; warehouse_id?: string | null;
      sent?: KitchenSendItem[]; items_sent_count?: number; items_processed?: number; all_sent?: boolean;
      inventory_deducted?: boolean; product_id?: string | null; product_name?: string | null;
    }>('send_to_kitchen', { p_order_id: orderId, p_sent_by: p.p_sent_by || null });

    if (rpcRes.error) return { success: false, error: 'KITCHEN_SEND_FAILED', detail: rpcRes.error.message };
    const result = rpcRes.data;
    if (!result?.success) return { success: false, error: result?.error || 'KITCHEN_SEND_FAILED', detail: result?.detail || result?.error || 'Kitchen send failed' };

    const rawSentItems = result.sent || [];
    if (rawSentItems.length > 0 && typeof window !== 'undefined') {
      const context = {
        orderNumber: result.order_number || result.order_id || orderId,
        tableName: result.table_name || null,
        orderType: result.order_type || null,
        guestCount: result.guest_count || null,
        isAr: document.documentElement.dir === 'rtl' || document.documentElement.lang?.startsWith('ar'),
      };

      const stationGroups = groupKitchenItemsByStation(rawSentItems);
      const allStations = Object.keys(stationGroups);
      const groupedItemCount = Object.values(stationGroups).reduce((count, items) => count + items.length, 0);
      if (groupedItemCount !== rawSentItems.length) {
        console.error('[kitchen-print] sent item missing station_code; item will not be silently rerouted', {
          orderId,
          missingStationItems: rawSentItems.length - groupedItemCount,
        });
      }

      const cloudQueuedStations = new Set<string>();
      try {
        const branchId = String(p.p_branch_id || '').trim();
        if (!branchId) {
          console.error('[cloud-print] kitchen dispatch skipped because branch id was not supplied by POS', { orderId });
        } else {
          const cloud = await enqueueCloudKitchenPrintJobs({ branchId, items: rawSentItems, context });
          for (const station of cloud.queuedStations) cloudQueuedStations.add(station);
          if (cloudQueuedStations.size > 0) suppressNextKitchenBrowserPopup();
          if (!cloud.accepted) {
            console.error('[cloud-print] one or more kitchen stations were not queued after retries', {
              orderId,
              branchId,
              failedStations: cloud.failedStations,
            });
          }
        }
      } catch (error) {
        console.warn('[cloud-print] kitchen queue unavailable; using station-level compatibility print path', error);
      }

      const fallbackStations = allStations.filter((station) => !cloudQueuedStations.has(station));
      if (fallbackStations.length > 0) {
        const localResults = await Promise.all(fallbackStations.map(async (station) => ({
          station,
          printed: await printKitchenStationsLocally(stationGroups[station] || [], context),
        })));
        const locallyPrintedStations = localResults.filter((entry) => entry.printed).map((entry) => entry.station);
        const locallyFailedStations = localResults.filter((entry) => !entry.printed).map((entry) => entry.station);
        if (locallyPrintedStations.length > 0) suppressNextKitchenBrowserPopup();
        if (locallyFailedStations.length > 0) {
          console.warn('[kitchen-print] local fallback failed for stations', {
            orderId,
            stations: locallyFailedStations,
          });
        }
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
    return { success: false, error: 'KITCHEN_SEND_FAILED', detail: err instanceof Error ? err.message : 'Unknown error during kitchen send' };
  } finally {
    activeSendLocks.delete(orderId);
  }
}

export async function reverseOrderKitchenConsumption(orderId: string, reason?: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await rpc<{ success: boolean; error?: string; detail?: string }>('reverse_order_kitchen_consumption', { p_order_id: orderId, p_reason: reason || null });
    if (res.error) return { success: false, error: res.error.message };
    if (res.data?.success) return { success: true };
    return { success: false, error: res.data?.detail || res.data?.error || 'KITCHEN_REVERSAL_NOT_AVAILABLE' };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'KITCHEN_REVERSAL_NOT_AVAILABLE' };
  }
}
