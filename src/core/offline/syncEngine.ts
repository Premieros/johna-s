/**
 * Background & Triggered Offline Sync Engine
 * Watches network online/offline transitions, runs batch sync of queued sales/orders,
 * handles conflict prevention and emits sync progress/events.
 */

import { pos as posApi } from '@/api';
import {
  getAllOfflineSales,
  updateOfflineSaleStatus,
  removeOfflineSale,
  getPendingSalesCount,
  subscribeToQueueChanges,
  type OfflineSaleQueueItem,
} from './offlineStorage';

export interface SyncStatus {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  lastSyncTime: string | null;
  lastError: string | null;
  syncedRecentlyCount: number;
}

type SyncSubscriber = (status: SyncStatus) => void;

type SaleSyncResponse = {
  success?: boolean;
  sale_id?: string;
  error?: string;
  detail?: string;
  reconciled?: boolean;
};

class OfflineSyncEngine {
  private isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  private isSyncing = false;
  private pendingCount = 0;
  private lastSyncTime: string | null = null;
  private lastError: string | null = null;
  private syncedRecentlyCount = 0;
  private subscribers: Set<SyncSubscriber> = new Set();
  private timer: number | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.handleOnlineChange(true));
      window.addEventListener('offline', () => this.handleOnlineChange(false));
    }
    subscribeToQueueChanges((pendingCount) => {
      this.pendingCount = pendingCount;
      this.emit();
    });
  }

  public init() {
    void this.refreshPendingCount();
    // Auto-sync every 30 seconds if online
    if (typeof window !== 'undefined') {
      this.timer = window.setInterval(() => {
        if (this.isOnline && !this.isSyncing) {
          void this.syncAll();
        }
      }, 30000);
    }
  }

  public destroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public subscribe(cb: SyncSubscriber): () => void {
    this.subscribers.add(cb);
    cb(this.getStatus());
    return () => {
      this.subscribers.delete(cb);
    };
  }

  public getStatus(): SyncStatus {
    return {
      isOnline: this.isOnline,
      isSyncing: this.isSyncing,
      pendingCount: this.pendingCount,
      lastSyncTime: this.lastSyncTime,
      lastError: this.lastError,
      syncedRecentlyCount: this.syncedRecentlyCount,
    };
  }

  private emit() {
    const status = this.getStatus();
    this.subscribers.forEach((cb) => {
      try {
        cb(status);
      } catch (e) {
        console.error('[OfflineSyncEngine] Subscriber error:', e);
      }
    });
  }

  private handleOnlineChange(online: boolean) {
    this.isOnline = online;
    this.emit();
    if (online) {
      void this.syncAll();
    }
  }

  public async refreshPendingCount() {
    this.pendingCount = await getPendingSalesCount();
    this.emit();
  }

  private async reconcileCommittedSale(item: OfflineSaleQueueItem): Promise<SaleSyncResponse | null> {
    const branchId = String(item.payload.p_branch_id || '');
    const paidAmount = Number(item.payload.p_paid_amount);
    const paymentMethod = String(item.payload.p_payment_method || '');
    const invoiceNumber = String(item.payload.p_invoice_number || item.invoice_number || '');

    if (!branchId || !invoiceNumber.startsWith('INV-OFF-') || !Number.isFinite(paidAmount) || !paymentMethod) {
      return null;
    }

    try {
      const { data, error } = await posApi.reconcileOfflineSale({
        p_invoice_number: invoiceNumber,
        p_branch_id: branchId,
        p_paid_amount: paidAmount,
        p_payment_method: paymentMethod,
      });
      if (error) return null;
      const result = data as SaleSyncResponse | null;
      return result?.success === true && Boolean(result.sale_id) ? result : null;
    } catch {
      return null;
    }
  }

  public async syncAll(): Promise<{ successCount: number; failedCount: number }> {
    if (!this.isOnline || this.isSyncing) {
      return { successCount: 0, failedCount: 0 };
    }

    const items = await getAllOfflineSales();
    // A row can remain persisted as `syncing` if the tab/process dies after the
    // server commit. It must be retried/reconciled on the next startup.
    const pendingItems = items.filter((i) => i.status !== 'synced');

    if (pendingItems.length === 0) {
      this.pendingCount = 0;
      this.emit();
      return { successCount: 0, failedCount: 0 };
    }

    this.isSyncing = true;
    this.lastError = null;
    this.emit();

    let successCount = 0;
    let failedCount = 0;

    for (const item of pendingItems) {
      try {
        await updateOfflineSaleStatus(item.id, 'syncing');

        // Call the authoritative sale RPC. A sync is confirmed only by an
        // explicit success=true plus a durable sale_id; null/undefined data is
        // never treated as success.
        const { data, error } = await posApi.processSale(
          item.payload as unknown as Parameters<typeof posApi.processSale>[0]
        );
        const res = data as SaleSyncResponse | null;

        let confirmed = !error && res?.success === true && Boolean(res.sale_id);
        if (!confirmed) {
          // If the response was lost after COMMIT (or a retry hit the unique
          // invoice guard), reconcile by the offline invoice key before retrying.
          const reconciled = await this.reconcileCommittedSale(item);
          confirmed = Boolean(reconciled?.success && reconciled.sale_id);
        }

        if (!confirmed) {
          const message = error?.message || res?.detail || res?.error || 'Offline sale was not confirmed by the server';
          throw new Error(message);
        }

        // Successfully synced/reconciled -> delete from queue.
        await removeOfflineSale(item.id);
        successCount++;
        this.syncedRecentlyCount++;
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : 'Sync failed';
        console.warn('[OfflineSyncEngine] Failed syncing item:', item.id, err);
        failedCount++;
        this.lastError = errorMsg;
        await updateOfflineSaleStatus(item.id, 'failed', errorMsg);
      }
    }

    this.isSyncing = false;
    this.lastSyncTime = new Date().toISOString();
    this.pendingCount = await getPendingSalesCount();
    this.emit();

    return { successCount, failedCount };
  }
}

export const offlineSyncEngine = new OfflineSyncEngine();
offlineSyncEngine.init();
