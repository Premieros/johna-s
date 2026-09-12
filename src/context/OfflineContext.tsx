import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { offlineSyncEngine, type SyncStatus } from '@/core/offline/syncEngine';
import {
  saveOfflineCache,
  getOfflineCache,
  saveOfflineSetting,
  getOfflineSetting,
  enqueueOfflineSale,
  getAllOfflineSales,
  removeOfflineSale,
  type OfflineSaleQueueItem,
} from '@/core/offline/offlineStorage';
import type { Product, Category, Customer, DiningTable, Settings, Branch } from '@/lib/types';

interface OfflineContextValue {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  lastSyncTime: string | null;
  lastError: string | null;
  syncedRecentlyCount: number;
  syncNow: () => Promise<{ successCount: number; failedCount: number }>;
  cachePosData: (data: {
    branchId: string;
    products?: Product[];
    categories?: Category[];
    customers?: Customer[];
    tables?: DiningTable[];
    settings?: Settings | null;
    branches?: Branch[];
    stockMap?: Record<string, number>;
    rawShortageOnly?: Record<string, boolean>;
  }) => Promise<void>;
  loadCachedPosData: (branchId?: string) => Promise<{
    products: Product[];
    categories: Category[];
    customers: Customer[];
    tables: DiningTable[];
    branches: Branch[];
    settings: Settings | null;
    stockMap: Record<string, number>;
    rawShortageOnly: Record<string, boolean>;
  }>;
  queueSaleForOffline: (invoiceNumber: string, payload: Record<string, unknown>) => Promise<string>;
  getOfflineQueue: () => Promise<OfflineSaleQueueItem[]>;
  discardQueuedSale: (id: string) => Promise<void>;
}

const OfflineContext = createContext<OfflineContextValue | null>(null);

function belongsToBranch(value: unknown, branchId?: string): boolean {
  if (!branchId || !value || typeof value !== 'object') return false;
  return (value as { branch_id?: string | null }).branch_id === branchId;
}

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<SyncStatus>(() => offlineSyncEngine.getStatus());

  useEffect(() => {
    const unsub = offlineSyncEngine.subscribe((st) => setStatus(st));
    return unsub;
  }, []);

  const syncNow = useCallback(async () => {
    return await offlineSyncEngine.syncAll();
  }, []);

  const cachePosData = useCallback(
    async (data: {
      branchId: string;
      products?: Product[];
      categories?: Category[];
      customers?: Customer[];
      tables?: DiningTable[];
      settings?: Settings | null;
      branches?: Branch[];
      stockMap?: Record<string, number>;
      rawShortageOnly?: Record<string, boolean>;
    }) => {
      if (data.products) await saveOfflineCache('products', data.products);
      if (data.categories) await saveOfflineCache('categories', data.categories);
      if (data.customers) await saveOfflineCache('customers', data.customers);
      if (data.tables) await saveOfflineCache('dining_tables', data.tables);
      if (data.branches) await saveOfflineCache('branches', data.branches);
      if (data.settings) await saveOfflineSetting('settings_' + data.branchId, data.settings);
      if (data.stockMap) {
        const stockItems = Object.entries(data.stockMap).map(([productId, quantity]) => ({
          productId,
          quantity,
          branch_id: data.branchId,
          rawShortageOnly: data.rawShortageOnly?.[productId] === true,
        }));
        await saveOfflineCache('stock_map', stockItems);
      }
    },
    []
  );

  const loadCachedPosData = useCallback(async (branchId?: string) => {
    // Offline business data is never returned without an explicit branch scope.
    // This prevents an empty/unauthorized online result from falling through to
    // a catalog cached by a different branch or a previous signed-in account.
    if (!branchId) {
      return {
        products: [],
        categories: [],
        customers: [],
        tables: [],
        branches: [],
        settings: null,
        stockMap: {},
        rawShortageOnly: {},
      };
    }

    const [allProducts, allCategories, allCustomers, allTables, allBranches, stockArr, cachedSettings] = await Promise.all([
      getOfflineCache<Product>('products'),
      getOfflineCache<Category>('categories'),
      getOfflineCache<Customer>('customers'),
      getOfflineCache<DiningTable>('dining_tables'),
      getOfflineCache<Branch>('branches'),
      getOfflineCache<{ productId: string; quantity: number; branch_id?: string; rawShortageOnly?: boolean }>('stock_map'),
      getOfflineSetting<Settings>('settings_' + branchId),
    ]);

    const products = allProducts.filter((item) => belongsToBranch(item, branchId));
    const categories = allCategories.filter((item) => belongsToBranch(item, branchId));
    const customers = allCustomers.filter((item) => belongsToBranch(item, branchId));
    const tables = allTables.filter((item) => belongsToBranch(item, branchId));
    const branches = allBranches.filter((item) => item.id === branchId);

    const allowedProductIds = new Set(products.map((product) => product.id));
    const stockMap: Record<string, number> = {};
    const rawShortageOnly: Record<string, boolean> = {};
    for (const item of stockArr) {
      if (item.branch_id === branchId && allowedProductIds.has(item.productId)) {
        stockMap[item.productId] = item.quantity;
        if (item.rawShortageOnly) rawShortageOnly[item.productId] = true;
      }
    }

    return {
      products,
      categories,
      customers,
      tables,
      branches,
      settings: cachedSettings || null,
      stockMap,
      rawShortageOnly,
    };
  }, []);

  const queueSaleForOffline = useCallback(async (invoiceNumber: string, payload: Record<string, unknown>): Promise<string> => {
    const id = 'offline_sale_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    await enqueueOfflineSale({
      id,
      client_id: id,
      invoice_number: invoiceNumber,
      created_at: new Date().toISOString(),
      payload,
    });
    return id;
  }, []);

  const getOfflineQueue = useCallback(async () => {
    return await getAllOfflineSales();
  }, []);

  const discardQueuedSale = useCallback(async (id: string) => {
    await removeOfflineSale(id);
    await offlineSyncEngine.refreshPendingCount();
  }, []);

  const value: OfflineContextValue = {
    ...status,
    syncNow,
    cachePosData,
    loadCachedPosData,
    queueSaleForOffline,
    getOfflineQueue,
    discardQueuedSale,
  };

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

const defaultOfflineValue: OfflineContextValue = {
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  isSyncing: false,
  pendingCount: 0,
  lastSyncTime: null,
  lastError: null,
  syncedRecentlyCount: 0,
  syncNow: async () => ({ successCount: 0, failedCount: 0 }),
  cachePosData: async () => {},
  loadCachedPosData: async () => ({
    products: [],
    categories: [],
    customers: [],
    tables: [],
    branches: [],
    settings: null,
    stockMap: {},
    rawShortageOnly: {},
  }),
  queueSaleForOffline: async () => '',
  getOfflineQueue: async () => [],
  discardQueuedSale: async () => {},
};

export function useOffline() {
  const ctx = useContext(OfflineContext);
  return ctx || defaultOfflineValue;
}
