/**
 * Premier POS IndexedDB Offline Storage & Local Sync Engine
 * Stores products, categories, customers, dining tables, settings, active shifts,
 * and queues offline sales/orders to sync automatically once back online.
 */

export interface OfflineSaleQueueItem {
  id: string; // client UUID
  client_id: string;
  invoice_number: string;
  created_at: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  error?: string;
  retry_count: number;
}

export interface OfflineHoldOrderQueueItem {
  id: string;
  created_at: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  error?: string;
}

const DB_NAME = 'premier_pos_offline_db';
// Version 3 adds the branch cache store that OfflineContext already reads/writes.
// The upgrade is additive and preserves all existing queues/caches.
const DB_VERSION = 3;

let dbPromise: Promise<IDBDatabase> | null = null;

export function openOfflineDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not supported in this environment'));
      return;
    }

    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;

      // Cache stores (branch scoped data)
      if (!db.objectStoreNames.contains('products')) {
        db.createObjectStore('products', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('categories')) {
        db.createObjectStore('categories', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('customers')) {
        db.createObjectStore('customers', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('dining_tables')) {
        db.createObjectStore('dining_tables', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('dining_areas')) {
        db.createObjectStore('dining_areas', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('branches')) {
        db.createObjectStore('branches', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('stock_map')) {
        db.createObjectStore('stock_map', { keyPath: 'productId' });
      }
      if (!db.objectStoreNames.contains('system_settings')) {
        db.createObjectStore('system_settings', { keyPath: 'key' });
      }

      // Outbox Sync queues
      if (!db.objectStoreNames.contains('sales_queue')) {
        const salesStore = db.createObjectStore('sales_queue', { keyPath: 'id' });
        salesStore.createIndex('status', 'status', { unique: false });
        salesStore.createIndex('created_at', 'created_at', { unique: false });
      }

      if (!db.objectStoreNames.contains('orders_queue')) {
        const ordersStore = db.createObjectStore('orders_queue', { keyPath: 'id' });
        ordersStore.createIndex('status', 'status', { unique: false });
      }
    };

    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };

    req.onerror = () => {
      reject(req.error);
    };

    req.onblocked = () => {
      reject(new Error('IndexedDB upgrade is blocked by another open tab'));
    };
  }).catch((error) => {
    // A failed/blocked open must not poison all later attempts in this tab.
    dbPromise = null;
    throw error;
  });

  return dbPromise;
}

// ── Cache operations ─────────────────────────────────────────────

export async function saveOfflineCache<T>(storeName: string, items: T[]): Promise<void> {
  try {
    const db = await openOfflineDb();
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    await new Promise<void>((res, rej) => {
      const clearReq = store.clear();
      clearReq.onsuccess = () => res();
      clearReq.onerror = () => rej(clearReq.error);
    });

    for (const item of items) {
      store.put(item);
    }

    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
    });
  } catch (err) {
    console.warn(`[OfflineDB] Failed to cache ${storeName}:`, err);
  }
}

export async function getOfflineCache<T>(storeName: string): Promise<T[]> {
  try {
    const db = await openOfflineDb();
    return await new Promise<T[]>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction(storeName, 'readonly');
      } catch (error) {
        reject(error);
        return;
      }
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result as T[]);
      req.onerror = () => resolve([]);
      tx.onabort = () => resolve([]);
    });
  } catch (err) {
    console.warn(`[OfflineDB] Failed to load ${storeName}:`, err);
    return [];
  }
}

export async function saveOfflineSetting(key: string, value: unknown): Promise<void> {
  try {
    const db = await openOfflineDb();
    const tx = db.transaction('system_settings', 'readwrite');
    tx.objectStore('system_settings').put({ key, value });
  } catch (e) {
    console.warn('[OfflineDB] save setting error', e);
  }
}

export async function getOfflineSetting<T>(key: string): Promise<T | null> {
  try {
    const db = await openOfflineDb();
    return await new Promise<T | null>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction('system_settings', 'readonly');
      } catch (error) {
        reject(error);
        return;
      }
      const req = tx.objectStore('system_settings').get(key);
      req.onsuccess = () => resolve(req.result ? (req.result.value as T) : null);
      req.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    });
  } catch {
    return null;
  }
}

// ── Outbox / Sync Queue operations ──────────────────────────────

export async function enqueueOfflineSale(sale: Omit<OfflineSaleQueueItem, 'status' | 'retry_count'>): Promise<void> {
  const db = await openOfflineDb();
  const tx = db.transaction('sales_queue', 'readwrite');
  const queueItem: OfflineSaleQueueItem = {
    ...sale,
    status: 'pending',
    retry_count: 0,
  };
  tx.objectStore('sales_queue').put(queueItem);
  return new Promise((res, rej) => {
    tx.oncomplete = () => {
      notifyQueueListeners();
      res();
    };
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error || new Error('Offline sale queue transaction aborted'));
  });
}

export async function getPendingSalesCount(): Promise<number> {
  try {
    const db = await openOfflineDb();
    return await new Promise<number>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction('sales_queue', 'readonly');
      } catch (error) {
        reject(error);
        return;
      }
      const req = tx.objectStore('sales_queue').getAll();
      req.onsuccess = () => {
        const items = (req.result as OfflineSaleQueueItem[]) || [];
        // A persisted "syncing" row is still pending financial confirmation.
        // Counting it also prevents a crash/reload from making the queue appear empty.
        resolve(items.filter((i) => i.status !== 'synced').length);
      };
      req.onerror = () => resolve(0);
      tx.onabort = () => resolve(0);
    });
  } catch {
    return 0;
  }
}

export async function getAllOfflineSales(): Promise<OfflineSaleQueueItem[]> {
  try {
    const db = await openOfflineDb();
    return await new Promise<OfflineSaleQueueItem[]>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction('sales_queue', 'readonly');
      } catch (error) {
        reject(error);
        return;
      }
      const req = tx.objectStore('sales_queue').getAll();
      req.onsuccess = () => resolve((req.result as OfflineSaleQueueItem[]) || []);
      req.onerror = () => resolve([]);
      tx.onabort = () => resolve([]);
    });
  } catch {
    return [];
  }
}

export async function updateOfflineSaleStatus(
  id: string,
  status: OfflineSaleQueueItem['status'],
  error?: string
): Promise<void> {
  try {
    const db = await openOfflineDb();
    const tx = db.transaction('sales_queue', 'readwrite');
    const store = tx.objectStore('sales_queue');
    const req = store.get(id);
    req.onsuccess = () => {
      const item = req.result as OfflineSaleQueueItem | undefined;
      if (item) {
        item.status = status;
        if (error) item.error = error;
        else if (status !== 'failed') delete item.error;
        if (status === 'failed') item.retry_count = (item.retry_count || 0) + 1;
        store.put(item);
      }
    };
    tx.oncomplete = () => {
      notifyQueueListeners();
    };
  } catch (e) {
    console.warn('[OfflineDB] update sale error', e);
  }
}

export async function removeOfflineSale(id: string): Promise<void> {
  try {
    const db = await openOfflineDb();
    const tx = db.transaction('sales_queue', 'readwrite');
    tx.objectStore('sales_queue').delete(id);
    tx.oncomplete = () => {
      notifyQueueListeners();
    };
  } catch (e) {
    console.warn('[OfflineDB] remove sale error', e);
  }
}

// ── Queue Change Event Listeners ─────────────────────────────────

type QueueListener = (pendingCount: number) => void;
const queueListeners: Set<QueueListener> = new Set();

export function subscribeToQueueChanges(listener: QueueListener): () => void {
  queueListeners.add(listener);
  // initial broadcast
  void getPendingSalesCount().then((count) => listener(count));
  return () => {
    queueListeners.delete(listener);
  };
}

function notifyQueueListeners() {
  void getPendingSalesCount().then((count) => {
    queueListeners.forEach((l) => l(count));
  });
}
