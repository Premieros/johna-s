import type { Permission } from '@/lib/permissions';
import type { TranslationKey } from '@/lib/i18n';
import { APP_ROUTES, type AppRoute } from './routes';

export type MenuGroup = 'main' | 'catalog' | 'operations' | 'centers' | 'people' | 'finance' | 'admin';
export type MenuIcon =
  | 'dashboard' | 'pos' | 'products' | 'pricing' | 'productModifiers' | 'categories' | 'components' | 'rawMaterials' | 'recipes' | 'inventory' | 'warehouses' | 'transfers'
  | 'inventoryLedger' | 'stockCounts' | 'inventoryBatches' | 'stockValuation' | 'lowStockAlerts' | 'inventoryUnits' | 'wasteCenter' | 'kitchenDisplay' | 'kitchenStations' | 'costingCenter' | 'branches' | 'purchases' | 'customers' | 'suppliers' | 'expenses'
  | 'accounts' | 'payments' | 'journal' | 'treasury' | 'reconciliation' | 'financialReports' | 'sales' | 'shifts' | 'reports' | 'users' | 'auditLog' | 'settings' | 'superAdmin' | 'importExport';

export interface MenuItemConfig {
  id: string;
  route: AppRoute;
  icon: MenuIcon;
  labelKey: TranslationKey;
  label?: { ar: string; en: string };
  permission?: Permission;
  permissionsAny?: Permission[];
  group: MenuGroup;
  superAdminOnly?: boolean;
  ownerOnly?: boolean;
}

export const MENU_GROUPS: Record<MenuGroup, { ar: string; en: string }> = {
  main: { ar: 'الرئيسية', en: 'Main' }, catalog: { ar: 'الكتالوج والمكونات', en: 'Catalog & Components' }, operations: { ar: 'العمليات', en: 'Operations' }, centers: { ar: 'مراكز الإدارة', en: 'Management Centers' }, people: { ar: 'الأطراف', en: 'People' }, finance: { ar: 'المالية', en: 'Finance' }, admin: { ar: 'الإدارة', en: 'Admin' },
};

export const MENU_ITEMS: MenuItemConfig[] = [
  { id: 'dashboard', route: APP_ROUTES.dashboard, icon: 'dashboard', labelKey: 'dashboard', permission: 'dashboard.view', group: 'main' },
  { id: 'pos', route: APP_ROUTES.pos, icon: 'pos', labelKey: 'pos', permission: 'pos.view', group: 'main' },
  { id: 'floor-plan', route: APP_ROUTES.floorPlan, icon: 'pos', labelKey: 'orders', label: { ar: 'الطاولات والطلبات النشطة', en: 'Tables & Active Orders' }, permission: 'floor_plan.view', group: 'main' },
  { id: 'kitchen-display', route: APP_ROUTES.kitchenDisplay, icon: 'kitchenDisplay', labelKey: 'kitchenDisplay', permission: 'pos.kds_view', group: 'main' },
  { id: 'operations-center', route: APP_ROUTES.operationsCenter, icon: 'pos', labelKey: 'orders', permission: 'dashboard.view', group: 'centers' },
  { id: 'inventory-center', route: APP_ROUTES.inventoryCenter, icon: 'inventory', labelKey: 'inventory', permission: 'inventory.view', group: 'centers' },
  { id: 'inventory', route: APP_ROUTES.inventory, icon: 'inventory', labelKey: 'inventory', permission: 'inventory.view', group: 'operations' },
  { id: 'warehouses', route: APP_ROUTES.warehouses, icon: 'warehouses', labelKey: 'warehouses', permission: 'warehouses.view', group: 'operations' },
  { id: 'transfers', route: APP_ROUTES.transfers, icon: 'transfers', labelKey: 'transfers', label: { ar: 'التحويلات المخزنية', en: 'Stock Transfers' }, permission: 'inventory.view', group: 'operations' },
  { id: 'inventory-ledger', route: APP_ROUTES.inventoryLedger, icon: 'inventoryLedger', labelKey: 'inventory', label: { ar: 'حركة المخزون', en: 'Inventory Ledger' }, permission: 'inventory.ledger.view', group: 'operations' },
  { id: 'stock-counts', route: APP_ROUTES.stockCounts, icon: 'stockCounts', labelKey: 'inventory', label: { ar: 'الجرد المخزني', en: 'Stock Counts' }, permission: 'inventory.view', group: 'operations' },
  { id: 'inventory-batches', route: APP_ROUTES.inventoryBatches, icon: 'inventoryBatches', labelKey: 'inventory', label: { ar: 'دفعات المخزون', en: 'Inventory Batches' }, permission: 'inventory.view', group: 'operations' },
  { id: 'stock-valuation', route: APP_ROUTES.stockValuation, icon: 'stockValuation', labelKey: 'inventory', label: { ar: 'تقييم المخزون', en: 'Stock Valuation' }, permission: 'inventory.ledger.view', group: 'operations' },
  { id: 'low-stock-alerts', route: APP_ROUTES.lowStockAlerts, icon: 'lowStockAlerts', labelKey: 'inventory', label: { ar: 'تنبيهات نقص المخزون', en: 'Low Stock Alerts' }, permission: 'inventory.view', group: 'operations' },
  { id: 'procurement-center', route: APP_ROUTES.procurementCenter, icon: 'purchases', labelKey: 'purchases', permission: 'purchases.view', group: 'centers' },
  { id: 'purchases', route: APP_ROUTES.purchases, icon: 'purchases', labelKey: 'purchases', permission: 'purchases.view', group: 'operations' },
  { id: 'purchase-requests', route: APP_ROUTES.purchaseRequests, icon: 'purchases', labelKey: 'purchases', label: { ar: 'طلبات الشراء', en: 'Purchase Requests' }, permission: 'purchases.requests', group: 'operations' },
  { id: 'rfqs', route: APP_ROUTES.rfqs, icon: 'purchases', labelKey: 'purchases', label: { ar: 'عروض الأسعار', en: 'RFQs & Quotations' }, permission: 'purchases.rfq', group: 'operations' },
  { id: 'receiving', route: APP_ROUTES.receiving, icon: 'purchases', labelKey: 'purchases', label: { ar: 'استلام المشتريات', en: 'Purchase Receiving' }, permission: 'purchases.receiving', group: 'operations' },
  { id: 'waste-center', route: APP_ROUTES.wasteCenter, icon: 'wasteCenter', labelKey: 'wasteCenter', permission: 'waste.view', group: 'centers' },
  { id: 'products', route: APP_ROUTES.products, icon: 'products', labelKey: 'products', permission: 'products.view', group: 'catalog' },
  { id: 'pricing', route: APP_ROUTES.pricing, icon: 'pricing', labelKey: 'products', label: { ar: 'التسعير', en: 'Pricing' }, permission: 'products.view', group: 'catalog' },
  { id: 'product-modifiers', route: APP_ROUTES.productModifiers, icon: 'productModifiers', labelKey: 'products', label: { ar: 'مجموعات الإضافات', en: 'Modifier Groups' }, permission: 'products.modifiers.manage', group: 'catalog' },
  { id: 'product-modifier-options', route: APP_ROUTES.productModifierOptions, icon: 'productModifiers', labelKey: 'products', label: { ar: 'الخيارات', en: 'Modifier Options' }, permission: 'products.modifiers.manage', group: 'catalog' },
  { id: 'raw-materials', route: APP_ROUTES.rawMaterials, icon: 'rawMaterials', labelKey: 'rawMaterials', permission: 'raw_materials.view', group: 'catalog' },
  { id: 'categories', route: APP_ROUTES.categories, icon: 'categories', labelKey: 'categories', permission: 'categories.view', group: 'catalog' },
  { id: 'inventory-units', route: APP_ROUTES.inventoryUnits, icon: 'inventoryUnits', labelKey: 'inventoryUnits', label: { ar: 'مجموعات المكونات', en: 'Component Groups' }, permission: 'raw_materials.view', group: 'catalog' },
  { id: 'branches', route: APP_ROUTES.branches, icon: 'branches', labelKey: 'branches', permission: 'branches.manage', group: 'operations' },
  { id: 'import-export', route: APP_ROUTES.importExport, icon: 'importExport', labelKey: 'importExport', permission: 'settings.manage', group: 'operations' },
  { id: 'customers', route: APP_ROUTES.customers, icon: 'customers', labelKey: 'customers', permission: 'customers.view', group: 'people' },
  { id: 'suppliers', route: APP_ROUTES.suppliers, icon: 'suppliers', labelKey: 'suppliers', permission: 'suppliers.view', group: 'people' },
  { id: 'expenses', route: APP_ROUTES.expenses, icon: 'expenses', labelKey: 'expenses', permission: 'expenses.view', group: 'finance' },
  { id: 'costing-center', route: APP_ROUTES.costingCenter, icon: 'costingCenter', labelKey: 'costingCenter', permission: 'reports.costing', group: 'finance' },
  { id: 'accounts', route: APP_ROUTES.accounts, icon: 'accounts', labelKey: 'chartOfAccounts', permission: 'accounts.view', group: 'finance' },
  { id: 'employee-receivables', route: APP_ROUTES.employeeReceivables, icon: 'customers', labelKey: 'customers', label: { ar: 'ذمم الموظفين', en: 'Employee Receivables' }, permission: 'accounts.view', group: 'finance' },
  { id: 'payments', route: APP_ROUTES.payments, icon: 'payments', labelKey: 'receivePayment', permission: 'accounts.view', group: 'finance' },
  { id: 'journal', route: APP_ROUTES.journal, icon: 'journal', labelKey: 'journalEntries', permission: 'accounts.view', group: 'finance' },
  { id: 'treasury', route: APP_ROUTES.treasury, icon: 'treasury', labelKey: 'treasury', permission: 'accounts.view', group: 'finance' },
  { id: 'reconciliation', route: APP_ROUTES.reconciliation, icon: 'reconciliation', labelKey: 'bankReconciliation', permission: 'accounts.view', group: 'finance' },
  { id: 'sales', route: APP_ROUTES.sales, icon: 'sales', labelKey: 'salesInvoices', permission: 'sales.view', group: 'finance' },
  { id: 'shifts', route: APP_ROUTES.shifts, icon: 'shifts', labelKey: 'shifts', permission: 'shifts.view', group: 'finance' },
  { id: 'reports', route: APP_ROUTES.reports, icon: 'reports', labelKey: 'reports', permissionsAny: ['reports.view', 'reports.financial'], group: 'finance' },
  { id: 'financial-reports', route: APP_ROUTES.financialReports, icon: 'financialReports', labelKey: 'reports', label: { ar: 'التقارير المالية', en: 'Financial Reports' }, permission: 'reports.financial', group: 'finance' },
  { id: 'super-admin', route: APP_ROUTES.superAdmin, icon: 'superAdmin', labelKey: 'superAdmin', permission: 'settings.manage', group: 'admin', superAdminOnly: true },
  { id: 'users', route: APP_ROUTES.users, icon: 'users', labelKey: 'users', permission: 'users.view', group: 'admin' },
  { id: 'permissions', route: APP_ROUTES.permissions, icon: 'users', labelKey: 'settings', label: { ar: 'الصلاحيات والأدوار', en: 'Roles & Permissions' }, permission: 'roles.permissions.manage', group: 'admin' },
  { id: 'approvals', route: APP_ROUTES.approvals, icon: 'settings', labelKey: 'settings', label: { ar: 'مركز الموافقات', en: 'Approval Center' }, permission: 'approvals.review', group: 'admin' },
  { id: 'kitchen-stations', route: APP_ROUTES.kitchenStations, icon: 'kitchenStations', labelKey: 'kitchenStations', permission: 'settings.manage', group: 'admin' },
  { id: 'audit-log', route: APP_ROUTES.auditLog, icon: 'auditLog', labelKey: 'auditLog', permission: 'audit.view', group: 'admin' },
  { id: 'settings', route: APP_ROUTES.settings, icon: 'settings', labelKey: 'settings', permission: 'settings.manage', group: 'admin' },
  { id: 'system-health', route: APP_ROUTES.systemHealth, icon: 'settings', labelKey: 'settings', label: { ar: 'صحة النظام', en: 'System Health' }, permission: 'settings.manage', group: 'admin' },
];
