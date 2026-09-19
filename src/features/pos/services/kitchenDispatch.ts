import type { KitchenSendItem, KitchenStationDispatchSummary } from '../types';
import { enqueueCloudKitchenPrintJobs } from './cloudPrint';
import {
  groupKitchenItemsByStation,
  printKitchenStationsLocally,
  suppressNextKitchenBrowserPopup,
  type LocalKitchenPrintContext,
} from './localPrintAgent';

export async function dispatchKitchenStations(params: {
  orderId: string;
  branchId?: string | null;
  items: KitchenSendItem[];
  context: LocalKitchenPrintContext;
  idempotencyNamespace?: string;
}): Promise<KitchenStationDispatchSummary> {
  const stationGroups = groupKitchenItemsByStation(params.items);
  const allStations = Object.keys(stationGroups);
  const groupedItemCount = Object.values(stationGroups).reduce((count, items) => count + items.length, 0);
  const missingStationItems = Math.max(0, params.items.length - groupedItemCount);

  if (params.items.length === 0) {
    return { status: 'not_needed', stations: [], failed_stations: [], missing_station_items: 0 };
  }

  const cloudQueuedStations = new Set<string>();
  const branchId = String(params.branchId || '').trim();

  if (branchId && allStations.length > 0) {
    try {
      const cloud = await enqueueCloudKitchenPrintJobs({
        branchId,
        items: params.items,
        context: params.context,
        idempotencyNamespace: params.idempotencyNamespace,
      });
      for (const station of cloud.queuedStations) cloudQueuedStations.add(station);
    } catch (error) {
      console.warn('[kitchen-dispatch] cloud queue unavailable; falling back by station', {
        orderId: params.orderId,
        error,
      });
    }
  } else if (!branchId) {
    console.error('[kitchen-dispatch] branch id missing', { orderId: params.orderId });
  }

  const results = await Promise.all(allStations.map(async (station) => {
    const items = stationGroups[station] || [];
    if (cloudQueuedStations.has(station)) {
      return {
        station_code: station,
        item_count: items.length,
        state: 'queued' as const,
      };
    }

    const localPrinted = await printKitchenStationsLocally(items, params.context);
    return {
      station_code: station,
      item_count: items.length,
      state: localPrinted ? ('local_printed' as const) : ('failed' as const),
      detail: localPrinted ? undefined : 'STATION_DISPATCH_FAILED',
    };
  }));

  const successfulStations = results.filter((entry) => entry.state !== 'failed').length;
  const failedStations = results.filter((entry) => entry.state === 'failed').map((entry) => entry.station_code);

  if (successfulStations > 0) suppressNextKitchenBrowserPopup();

  let status: KitchenStationDispatchSummary['status'] = 'complete';
  if (failedStations.length > 0 || missingStationItems > 0) {
    status = successfulStations > 0 ? 'partial' : 'failed';
  }

  if (missingStationItems > 0) {
    console.error('[kitchen-dispatch] sent items missing station assignment', {
      orderId: params.orderId,
      missingStationItems,
    });
  }
  if (failedStations.length > 0) {
    console.error('[kitchen-dispatch] stations failed', {
      orderId: params.orderId,
      failedStations,
    });
  }

  return {
    status,
    stations: results,
    failed_stations: failedStations,
    missing_station_items: missingStationItems,
  };
}
