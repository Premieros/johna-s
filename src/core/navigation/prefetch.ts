import { APP_ROUTES } from '@/core/navigation/routes';

type RouteLoader = () => Promise<unknown>;

const routeLoaders: Partial<Record<string, RouteLoader>> = {
  [APP_ROUTES.dashboard]: () => import('@/features/dashboard/pages/DashboardEnhancedPage'),
  [APP_ROUTES.pos]: () => import('@/features/pos/pages/PosWorkspacePage'),
  [APP_ROUTES.operationsCenter]: () => import('@/features/operations/pages/OperationsCenterPage'),
  [APP_ROUTES.inventoryCenter]: () => import('@/features/inventory/pages/InventoryCenterPage'),
  [APP_ROUTES.procurementCenter]: () => import('@/features/trade/pages/ProcurementCenterPage'),
  [APP_ROUTES.products]: () => import('@/features/catalog/pages/ProductsPage'),
  [APP_ROUTES.inventory]: () => import('@/features/inventory/pages/InventoryPage'),
  [APP_ROUTES.inventoryLedger]: () => import('@/features/inventory/pages/InventoryLedgerPage'),
  [APP_ROUTES.purchases]: () => import('@/features/trade/pages/PurchasesPage'),
  [APP_ROUTES.sales]: () => import('@/features/trade/pages/SalesPage'),
  [APP_ROUTES.reports]: () => import('@/features/reporting/pages/ReportsCenterPage'),
  [APP_ROUTES.financialReports]: () => import('@/features/accounting/pages/FinancialReportsPage'),
  [APP_ROUTES.settings]: () => import('@/features/admin/pages/SettingsControlCenterPage'),
};

const prefetched = new Set<string>();

export function prefetchAppRoute(route: string): void {
  const baseRoute = route.startsWith(`${APP_ROUTES.pos}/`) ? APP_ROUTES.pos : route;
  const loader = routeLoaders[baseRoute];
  if (!loader || prefetched.has(baseRoute)) return;
  prefetched.add(baseRoute);
  void loader().catch(() => {
    prefetched.delete(baseRoute);
  });
}
