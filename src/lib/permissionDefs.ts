import type { Role } from './types';

export type { Role };

/**
 * Canonical permission model.
 * Super Admin remains the only implicit platform-wide bypass.
 */
export type Permission =
  | 'dashboard.view'
  | 'pos.view' | 'pos.order.create' | 'pos.order.edit' | 'pos.payment.take'
  | 'pos.order.split' | 'pos.order.transfer' | 'pos.receipt.print'
  | 'pos.discount' | 'pos.change_price' | 'pos.reprint'
  | 'pos.hold' | 'pos.send_kitchen' | 'pos.kds_view' | 'pos.kds_update' | 'pos.print_kitchen'
  | 'pos.void' | 'pos.cancel_order' | 'pos.refund' | 'pos.change_branch'
  | 'sales.print' | 'sales.export'
  | 'purchases.print' | 'purchases.delete'
  | 'products.print' | 'products.export' | 'products.import'
  | 'customers.print' | 'customers.export'
  | 'suppliers.print'
  | 'expenses.print'
  | 'reports.print' | 'reports.export'
  | 'floor_plan.view' | 'floor_plan.manage'
  | 'products.view' | 'products.create' | 'products.edit' | 'products.delete' | 'products.modifiers.manage'
  | 'categories.view' | 'categories.manage'
  | 'components.view' | 'components.manage'
  | 'purchases.view' | 'purchases.manage'
  | 'purchases.requests' | 'purchases.rfq' | 'purchases.receiving' | 'purchases.evaluation'
  | 'inventory.view' | 'inventory.adjust' | 'inventory.count.create' | 'inventory.count.approve'
  | 'inventory.transfer.create' | 'inventory.transfer.approve' | 'inventory.ledger.view'
  | 'raw_materials.view' | 'raw_materials.manage'
  | 'recipes.view' | 'recipes.manage'
  | 'production.view' | 'production.manage' | 'production.waste'
  | 'waste.view' | 'waste.create' | 'waste.approve' | 'waste.report'
  | 'warehouses.view' | 'warehouses.manage'
  | 'customers.view' | 'customers.manage'
  | 'suppliers.view' | 'suppliers.manage'
  | 'expenses.view' | 'expenses.manage'
  | 'sales.view' | 'sales.refund.create' | 'sales.payment.receive'
  | 'employees.credit.view' | 'employees.credit.create' | 'employees.credit.settle'
  | 'refunds.approve'
  | 'reports.view' | 'reports.financial' | 'reports.costing'
  | 'accounts.view' | 'accounts.manage'
  | 'shifts.view' | 'shifts.open' | 'shifts.close' | 'shifts.manage'
  | 'shifts.report.user' | 'shifts.report.shift' | 'shifts.day_close'
  | 'approvals.review' | 'approvals.override' | 'approvals.policy.manage'
  | 'procurement.request.create' | 'procurement.order.create' | 'procurement.receive' | 'procurement.payment.create'
  | 'accounting.journal.post' | 'accounting.treasury.transfer' | 'accounting.reconciliation.manage'
  | 'users.create' | 'users.branches.manage' | 'roles.permissions.manage'
  | 'users.view' | 'users.manage'
  | 'audit.view'
  | 'settings.manage'
  | 'branches.manage';

export const ALL_PERMISSIONS: Permission[] = [
  'dashboard.view',
  'pos.view', 'pos.order.create', 'pos.order.edit', 'pos.payment.take',
  'pos.order.split', 'pos.order.transfer', 'pos.receipt.print',
  'pos.discount', 'pos.change_price', 'pos.reprint', 'pos.hold', 'pos.send_kitchen',
  'pos.kds_view', 'pos.kds_update', 'pos.print_kitchen', 'pos.void', 'pos.cancel_order', 'pos.refund', 'pos.change_branch',
  'floor_plan.view', 'floor_plan.manage',
  'sales.print', 'sales.export',
  'products.view', 'products.create', 'products.edit', 'products.delete', 'products.modifiers.manage',
  'products.print', 'products.export', 'products.import',
  'categories.view', 'categories.manage',
  'components.view', 'components.manage',
  'purchases.view', 'purchases.manage', 'purchases.print', 'purchases.delete',
  'purchases.requests', 'purchases.rfq', 'purchases.receiving', 'purchases.evaluation',
  'procurement.request.create', 'procurement.order.create', 'procurement.receive', 'procurement.payment.create',
  'inventory.view', 'inventory.adjust', 'inventory.count.create', 'inventory.count.approve',
  'inventory.transfer.create', 'inventory.transfer.approve', 'inventory.ledger.view',
  'raw_materials.view', 'raw_materials.manage',
  'recipes.view', 'recipes.manage',
  'production.view', 'production.manage', 'production.waste',
  'waste.view', 'waste.create', 'waste.approve', 'waste.report',
  'warehouses.view', 'warehouses.manage',
  'customers.view', 'customers.manage', 'customers.print', 'customers.export',
  'suppliers.view', 'suppliers.manage', 'suppliers.print',
  'expenses.view', 'expenses.manage', 'expenses.print',
  'sales.view', 'sales.refund.create', 'sales.payment.receive', 'refunds.approve',
  'employees.credit.view', 'employees.credit.create', 'employees.credit.settle',
  'reports.view', 'reports.financial', 'reports.costing', 'reports.print', 'reports.export',
  'accounts.view', 'accounts.manage', 'accounting.journal.post', 'accounting.treasury.transfer', 'accounting.reconciliation.manage',
  'shifts.view', 'shifts.open', 'shifts.close', 'shifts.manage', 'shifts.report.user', 'shifts.report.shift', 'shifts.day_close',
  'approvals.review', 'approvals.override', 'approvals.policy.manage',
  'users.view', 'users.manage', 'users.create', 'users.branches.manage', 'roles.permissions.manage',
  'audit.view', 'settings.manage', 'branches.manage',
];

export const PERMISSION_LABELS: Record<Permission, { ar: string; en: string }> = {
  'dashboard.view': { ar: 'عرض لوحة التحكم', en: 'View Dashboard' },
  'pos.view': { ar: 'عرض شاشة نقطة البيع', en: 'View POS' },
  'pos.order.create': { ar: 'إنشاء طلب من نقطة البيع', en: 'Create POS Orders' },
  'pos.order.edit': { ar: 'تعديل طلب من نقطة البيع', en: 'Edit POS Orders' },
  'pos.payment.take': { ar: 'تحصيل مدفوعات نقطة البيع', en: 'Take POS Payments' },
  'pos.order.split': { ar: 'فصل الطلب', en: 'Split POS Orders' },
  'pos.order.transfer': { ar: 'نقل أو دمج الطلب', en: 'Transfer or Merge POS Orders' },
  'pos.receipt.print': { ar: 'طباعة إيصال البيع أول مرة', en: 'Print First Sale Receipt' },
  'pos.discount': { ar: 'منح خصومات من نقطة البيع', en: 'Give POS Discounts' },
  'pos.change_price': { ar: 'تغيير سعر البيع من نقطة البيع', en: 'Change Sale Price in POS' },
  'pos.reprint': { ar: 'إعادة طباعة فاتورة بدون موافقة', en: 'Reprint Receipt Without Approval' },
  'pos.hold': { ar: 'تعليق واستئناف الطلب', en: 'Hold & Resume Orders' },
  'pos.send_kitchen': { ar: 'إرسال الطلب للمطبخ', en: 'Send Orders to Kitchen' },
  'pos.kds_view': { ar: 'عرض شاشة وطلبات المطبخ', en: 'View Kitchen / KDS' },
  'pos.kds_update': { ar: 'تحديث حالة طلبات المطبخ', en: 'Update Kitchen / KDS Status' },
  'pos.print_kitchen': { ar: 'طباعة تذكرة المطبخ', en: 'Print Kitchen Ticket' },
  'pos.void': { ar: 'بدء حذف/إلغاء صنف', en: 'Start Item Void' },
  'pos.cancel_order': { ar: 'بدء إلغاء الطلب بالكامل', en: 'Start Order Cancellation' },
  'pos.refund': { ar: 'بدء مرتجع من نقطة البيع', en: 'Initiate POS Refund' },
  'pos.change_branch': { ar: 'تغيير الفرع من نقطة البيع', en: 'Change POS Branch' },
  'sales.print': { ar: 'طباعة فواتير المبيعات', en: 'Print Sales Invoices' },
  'sales.export': { ar: 'تصدير فواتير المبيعات', en: 'Export Sales Invoices' },
  'purchases.print': { ar: 'طباعة فواتير المشتريات', en: 'Print Purchase Invoices' },
  'purchases.delete': { ar: 'حذف فواتير المشتريات غير المرحلة', en: 'Delete Unposted Purchase Invoices' },
  'products.print': { ar: 'طباعة المنتجات', en: 'Print Products' },
  'products.export': { ar: 'تصدير المنتجات', en: 'Export Products' },
  'products.import': { ar: 'استيراد المنتجات', en: 'Import Products' },
  'customers.print': { ar: 'طباعة العملاء', en: 'Print Customers' },
  'customers.export': { ar: 'تصدير العملاء', en: 'Export Customers' },
  'suppliers.print': { ar: 'طباعة الموردين', en: 'Print Suppliers' },
  'expenses.print': { ar: 'طباعة المصروفات', en: 'Print Expenses' },
  'reports.print': { ar: 'طباعة التقارير', en: 'Print Reports' },
  'reports.export': { ar: 'تصدير التقارير', en: 'Export Reports' },
  'floor_plan.view': { ar: 'عرض مخطط الصالة', en: 'View Floor Plan' },
  'floor_plan.manage': { ar: 'إدارة مخطط الصالة', en: 'Manage Floor Plan' },
  'products.view': { ar: 'عرض المنتجات', en: 'View Products' },
  'products.create': { ar: 'إنشاء منتج', en: 'Create Products' },
  'products.edit': { ar: 'تعديل منتج', en: 'Edit Products' },
  'products.delete': { ar: 'حذف منتج', en: 'Delete Products' },
  'products.modifiers.manage': { ar: 'إدارة موديفاير المنتجات', en: 'Manage Product Modifiers' },
  'categories.view': { ar: 'عرض الأصناف', en: 'View Categories' },
  'categories.manage': { ar: 'إدارة الأصناف', en: 'Manage Categories' },
  'components.view': { ar: 'عرض مكونات المنتجات', en: 'View Components' },
  'components.manage': { ar: 'إدارة مكونات المنتجات', en: 'Manage Components' },
  'purchases.view': { ar: 'عرض المشتريات', en: 'View Purchases' },
  'purchases.manage': { ar: 'إدارة المشتريات', en: 'Manage Purchases' },
  'purchases.requests': { ar: 'طلبات الشراء', en: 'Purchase Requests' },
  'purchases.rfq': { ar: 'عروض الأسعار', en: 'RFQ & Quotations' },
  'purchases.receiving': { ar: 'استلام المشتريات', en: 'Purchase Receiving' },
  'purchases.evaluation': { ar: 'تقييم الموردين', en: 'Supplier Evaluation' },
  'procurement.request.create': { ar: 'إنشاء طلب شراء', en: 'Create Purchase Requests' },
  'procurement.order.create': { ar: 'إنشاء أمر شراء', en: 'Create Purchase Orders' },
  'procurement.receive': { ar: 'استلام مشتريات', en: 'Receive Purchases' },
  'procurement.payment.create': { ar: 'تسجيل دفعة مورد', en: 'Create Supplier Payments' },
  'inventory.view': { ar: 'عرض المخزون', en: 'View Inventory' },
  'inventory.adjust': { ar: 'تسوية المخزون', en: 'Adjust Inventory' },
  'inventory.count.create': { ar: 'إنشاء وتحرير جرد مخزني', en: 'Create & Edit Stock Counts' },
  'inventory.count.approve': { ar: 'اعتماد ورفض وتطبيق الجرد', en: 'Approve, Reject & Apply Stock Counts' },
  'inventory.transfer.create': { ar: 'إنشاء تحويل مخزني', en: 'Create Inventory Transfers' },
  'inventory.transfer.approve': { ar: 'اعتماد أو رفض تحويل مخزني', en: 'Approve or Reject Inventory Transfers' },
  'inventory.ledger.view': { ar: 'عرض دفتر المخزون', en: 'View Inventory Ledger' },
  'raw_materials.view': { ar: 'عرض المواد الخام', en: 'View Raw Materials' },
  'raw_materials.manage': { ar: 'إدارة المواد الخام', en: 'Manage Raw Materials' },
  'recipes.view': { ar: 'عرض الوصفات', en: 'View Recipes' },
  'recipes.manage': { ar: 'إدارة الوصفات', en: 'Manage Recipes' },
  'production.view': { ar: 'عرض أوامر الإنتاج', en: 'View Production Orders' },
  'production.manage': { ar: 'إدارة أوامر الإنتاج', en: 'Manage Production Orders' },
  'production.waste': { ar: 'تسجيل هالك الإنتاج', en: 'Record Production Waste' },
  'waste.view': { ar: 'عرض مركز الهالك', en: 'View Waste Center' },
  'waste.create': { ar: 'تسجيل هالك', en: 'Record Waste' },
  'waste.approve': { ar: 'اعتماد الهالك', en: 'Approve Waste' },
  'waste.report': { ar: 'عرض تقرير الهالك', en: 'View Waste Reports' },
  'warehouses.view': { ar: 'عرض المخازن', en: 'View Warehouses' },
  'warehouses.manage': { ar: 'إدارة المخازن', en: 'Manage Warehouses' },
  'customers.view': { ar: 'عرض العملاء', en: 'View Customers' },
  'customers.manage': { ar: 'إدارة العملاء', en: 'Manage Customers' },
  'suppliers.view': { ar: 'عرض الموردين', en: 'View Suppliers' },
  'suppliers.manage': { ar: 'إدارة الموردين', en: 'Manage Suppliers' },
  'expenses.view': { ar: 'عرض المصروفات', en: 'View Expenses' },
  'expenses.manage': { ar: 'إدارة المصروفات', en: 'Manage Expenses' },
  'sales.view': { ar: 'عرض فواتير المبيعات', en: 'View Sales Invoices' },
  'sales.refund.create': { ar: 'إنشاء مرتجع مبيعات', en: 'Create Sales Refunds' },
  'sales.payment.receive': { ar: 'تحصيل دفعة عميل', en: 'Receive Customer Payments' },
  'employees.credit.view': { ar: 'عرض ذمم الموظفين', en: 'View Employee Credit' },
  'employees.credit.create': { ar: 'البيع الآجل للموظفين', en: 'Create Employee Credit Sales' },
  'employees.credit.settle': { ar: 'تسوية ذمم الموظفين', en: 'Settle Employee Credit' },
  'refunds.approve': { ar: 'الموافقة على المرتجعات', en: 'Approve Refunds' },
  'reports.view': { ar: 'عرض التقارير', en: 'View Reports' },
  'reports.financial': { ar: 'التقارير المالية', en: 'Financial Reports' },
  'reports.costing': { ar: 'التكلفة والربحية', en: 'Costing & Profitability' },
  'accounts.view': { ar: 'عرض الحسابات والقيود', en: 'View Accounts & Journal' },
  'accounts.manage': { ar: 'إدارة الحسابات', en: 'Manage Accounts' },
  'accounting.journal.post': { ar: 'ترحيل قيود اليومية', en: 'Post Journal Entries' },
  'accounting.treasury.transfer': { ar: 'تحويل بين الخزن', en: 'Transfer Treasury Funds' },
  'accounting.reconciliation.manage': { ar: 'إدارة التسويات البنكية', en: 'Manage Bank Reconciliation' },
  'shifts.view': { ar: 'عرض الشيفتات', en: 'View Shifts' },
  'shifts.open': { ar: 'فتح شيفت', en: 'Open Shift' },
  'shifts.close': { ar: 'إغلاق شيفت', en: 'Close Shift' },
  'shifts.manage': { ar: 'إدارة كل الشيفتات', en: 'Manage All Shifts' },
  'shifts.report.user': { ar: 'تقرير إغلاق المستخدم', en: 'User Closing Report' },
  'shifts.report.shift': { ar: 'تقرير إغلاق الشيفت', en: 'Shift Closing Report' },
  'shifts.day_close': { ar: 'إغلاق اليوم', en: 'Day Closing' },
  'approvals.review': { ar: 'مراجعة واعتماد الطلبات', en: 'Review & Decide Approvals' },
  'approvals.override': { ar: 'تجاوز منع الموافقة الذاتية', en: 'Self-Approval Override' },
  'approvals.policy.manage': { ar: 'إدارة سياسات الموافقات', en: 'Manage Approval Policies' },
  'users.view': { ar: 'عرض المستخدمين', en: 'View Users' },
  'users.manage': { ar: 'إدارة المستخدمين', en: 'Manage Users' },
  'users.create': { ar: 'إنشاء مستخدم', en: 'Create Users' },
  'users.branches.manage': { ar: 'إدارة فروع المستخدم', en: 'Manage User Branches' },
  'roles.permissions.manage': { ar: 'إدارة الأدوار والصلاحيات', en: 'Manage Role Permissions' },
  'audit.view': { ar: 'عرض سجل العمليات', en: 'View Audit Log' },
  'settings.manage': { ar: 'إدارة الإعدادات', en: 'Manage Settings' },
  'branches.manage': { ar: 'إدارة الفروع', en: 'Manage Branches' },
};

export interface PermissionGroup {
  key: string;
  ar: string;
  en: string;
  permissions: Permission[];
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  { key: 'dashboard', ar: 'لوحة التحكم', en: 'Dashboard', permissions: ['dashboard.view'] },
  { key: 'pos', ar: 'نقطة البيع', en: 'POS', permissions: ['pos.view', 'pos.order.create', 'pos.order.edit', 'pos.payment.take', 'pos.order.split', 'pos.order.transfer', 'pos.receipt.print', 'pos.discount', 'pos.change_price', 'pos.reprint', 'pos.hold', 'pos.send_kitchen', 'pos.kds_view', 'pos.kds_update', 'pos.print_kitchen', 'pos.void', 'pos.cancel_order', 'pos.refund', 'pos.change_branch', 'floor_plan.view', 'floor_plan.manage'] },
  { key: 'products', ar: 'المنتجات', en: 'Products', permissions: ['products.view', 'products.create', 'products.edit', 'products.delete', 'products.modifiers.manage', 'products.print', 'products.export', 'products.import'] },
  { key: 'categories', ar: 'الأصناف', en: 'Categories', permissions: ['categories.view', 'categories.manage'] },
  { key: 'components', ar: 'المكونات', en: 'Components', permissions: ['components.view', 'components.manage'] },
  { key: 'purchases', ar: 'المشتريات', en: 'Purchases', permissions: ['purchases.view', 'purchases.manage', 'purchases.print', 'purchases.delete', 'purchases.requests', 'purchases.rfq', 'purchases.receiving', 'purchases.evaluation', 'procurement.request.create', 'procurement.order.create', 'procurement.receive', 'procurement.payment.create'] },
  { key: 'inventory', ar: 'المخزون', en: 'Inventory', permissions: ['inventory.view', 'inventory.adjust', 'inventory.count.create', 'inventory.count.approve', 'inventory.transfer.create', 'inventory.transfer.approve', 'inventory.ledger.view'] },
  { key: 'raw_materials', ar: 'المواد الخام', en: 'Raw Materials', permissions: ['raw_materials.view', 'raw_materials.manage'] },
  { key: 'recipes', ar: 'الوصفات', en: 'Recipes', permissions: ['recipes.view', 'recipes.manage'] },
  { key: 'production', ar: 'الإنتاج والهالك', en: 'Production & Waste', permissions: ['production.view', 'production.manage', 'production.waste', 'waste.view', 'waste.create', 'waste.approve', 'waste.report'] },
  { key: 'warehouses', ar: 'المخازن', en: 'Warehouses', permissions: ['warehouses.view', 'warehouses.manage'] },
  { key: 'customers', ar: 'العملاء', en: 'Customers', permissions: ['customers.view', 'customers.manage', 'customers.print', 'customers.export'] },
  { key: 'suppliers', ar: 'الموردون', en: 'Suppliers', permissions: ['suppliers.view', 'suppliers.manage', 'suppliers.print'] },
  { key: 'employees_credit', ar: 'ذمم الموظفين', en: 'Employee Credit', permissions: ['employees.credit.view', 'employees.credit.create', 'employees.credit.settle'] },
  { key: 'sales', ar: 'المبيعات', en: 'Sales', permissions: ['sales.view', 'sales.refund.create', 'sales.payment.receive', 'sales.export', 'refunds.approve', 'sales.print'] },
  { key: 'expenses', ar: 'المصروفات', en: 'Expenses', permissions: ['expenses.view', 'expenses.manage', 'expenses.print'] },
  { key: 'accounts', ar: 'المحاسبة', en: 'Accounting', permissions: ['accounts.view', 'accounts.manage', 'accounting.journal.post', 'accounting.treasury.transfer', 'accounting.reconciliation.manage'] },
  { key: 'shifts', ar: 'الشيفتات', en: 'Shifts', permissions: ['shifts.view', 'shifts.open', 'shifts.close', 'shifts.manage', 'shifts.report.user', 'shifts.report.shift', 'shifts.day_close'] },
  { key: 'approvals', ar: 'الموافقات', en: 'Approvals', permissions: ['approvals.review', 'approvals.override', 'approvals.policy.manage'] },
  { key: 'reports', ar: 'التقارير', en: 'Reports', permissions: ['reports.view', 'reports.financial', 'reports.costing', 'reports.print', 'reports.export'] },
  { key: 'admin', ar: 'الإدارة', en: 'Administration', permissions: ['users.view', 'users.manage', 'users.create', 'users.branches.manage', 'roles.permissions.manage', 'audit.view', 'settings.manage', 'branches.manage'] },
];

export const DEFAULT_ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  super_admin: [...ALL_PERMISSIONS],
  owner: [...ALL_PERMISSIONS],
  branch_manager: ['dashboard.view', 'pos.view', 'pos.order.create', 'pos.order.edit', 'pos.payment.take', 'pos.order.split', 'pos.order.transfer', 'pos.receipt.print', 'pos.discount', 'pos.change_price', 'pos.reprint', 'pos.hold', 'pos.send_kitchen', 'pos.kds_view', 'pos.kds_update', 'pos.print_kitchen', 'pos.void', 'pos.cancel_order', 'pos.refund', 'floor_plan.view', 'floor_plan.manage', 'products.view', 'products.create', 'products.edit', 'products.delete', 'products.modifiers.manage', 'products.print', 'products.export', 'products.import', 'categories.view', 'categories.manage', 'components.view', 'components.manage', 'purchases.view', 'purchases.manage', 'purchases.print', 'purchases.delete', 'purchases.requests', 'purchases.rfq', 'purchases.receiving', 'purchases.evaluation', 'procurement.request.create', 'procurement.order.create', 'procurement.receive', 'procurement.payment.create', 'inventory.view', 'inventory.adjust', 'inventory.count.create', 'inventory.count.approve', 'inventory.transfer.create', 'inventory.transfer.approve', 'inventory.ledger.view', 'warehouses.view', 'warehouses.manage', 'customers.view', 'customers.manage', 'customers.print', 'customers.export', 'suppliers.view', 'suppliers.manage', 'suppliers.print', 'expenses.view', 'expenses.manage', 'expenses.print', 'sales.view', 'sales.refund.create', 'sales.payment.receive', 'refunds.approve', 'sales.print', 'sales.export', 'reports.view', 'reports.financial', 'reports.costing', 'reports.print', 'reports.export', 'accounts.view', 'accounts.manage', 'accounting.journal.post', 'accounting.treasury.transfer', 'accounting.reconciliation.manage', 'shifts.view', 'shifts.open', 'shifts.close', 'shifts.manage', 'approvals.review', 'approvals.override', 'approvals.policy.manage', 'users.view', 'users.manage', 'users.create', 'users.branches.manage', 'roles.permissions.manage', 'settings.manage'],
  cashier: ['dashboard.view', 'pos.view', 'pos.order.create', 'pos.order.edit', 'pos.payment.take', 'pos.order.split', 'pos.order.transfer', 'pos.receipt.print', 'pos.hold', 'pos.send_kitchen', 'pos.print_kitchen', 'pos.void', 'floor_plan.view', 'products.view', 'customers.view', 'customers.manage', 'inventory.view', 'sales.view', 'sales.print', 'shifts.view', 'shifts.open', 'shifts.close'],
  warehouse_manager: ['dashboard.view', 'products.view', 'products.create', 'products.edit', 'products.delete', 'products.print', 'products.export', 'products.import', 'categories.view', 'categories.manage', 'components.view', 'components.manage', 'inventory.view', 'inventory.adjust', 'inventory.count.create', 'inventory.count.approve', 'inventory.transfer.create', 'inventory.transfer.approve', 'inventory.ledger.view', 'warehouses.view', 'warehouses.manage', 'purchases.view', 'purchases.manage', 'purchases.print', 'purchases.requests', 'purchases.rfq', 'purchases.receiving', 'purchases.evaluation', 'suppliers.view', 'suppliers.manage', 'suppliers.print', 'shifts.view'],
  accountant: ['dashboard.view', 'sales.view', 'sales.print', 'sales.export', 'purchases.view', 'purchases.print', 'expenses.view', 'expenses.manage', 'expenses.print', 'inventory.view', 'customers.view', 'customers.print', 'customers.export', 'suppliers.view', 'suppliers.print', 'reports.view', 'reports.financial', 'reports.costing', 'reports.print', 'reports.export', 'accounts.view', 'accounts.manage', 'accounting.journal.post', 'accounting.treasury.transfer', 'accounting.reconciliation.manage', 'shifts.view'],
  production_manager: ['dashboard.view', 'pos.kds_view', 'pos.kds_update', 'products.view', 'products.create', 'products.edit', 'products.delete', 'products.print', 'products.export', 'products.import', 'categories.view', 'categories.manage', 'raw_materials.view', 'raw_materials.manage', 'recipes.view', 'recipes.manage', 'production.view', 'production.manage', 'production.waste', 'waste.view', 'waste.create', 'waste.approve', 'waste.report', 'inventory.view', 'inventory.adjust', 'inventory.transfer.create', 'inventory.transfer.approve', 'inventory.ledger.view', 'warehouses.view', 'warehouses.manage', 'purchases.view', 'purchases.manage', 'purchases.print', 'suppliers.view', 'suppliers.manage', 'suppliers.print', 'shifts.view'],
};

export interface RoleDef {
  role: Role;
  name_ar: string;
  name_en: string;
  permissions: Permission[];
  updated_at?: string;
}

export const ROLE_META: Record<Role, { ar: string; en: string }> = {
  super_admin: { ar: 'مدير عام', en: 'Super Admin' },
  owner: { ar: 'مالك', en: 'Owner' },
  branch_manager: { ar: 'مدير فرع', en: 'Branch Manager' },
  cashier: { ar: 'أمين صندوق', en: 'Cashier' },
  warehouse_manager: { ar: 'مدير مخازن', en: 'Warehouse Manager' },
  accountant: { ar: 'محاسب', en: 'Accountant' },
  production_manager: { ar: 'مدير إنتاج', en: 'Production Manager' },
};

/** Super Admin is the only platform-wide implicit role. */
export function isAdminRole(role?: Role | null): boolean {
  return role === 'super_admin';
}

export function hasPermission(
  role: Role | null | undefined,
  rolePermissionsMap: Record<string, Permission[]> | null | undefined,
  permission: Permission
): boolean {
  if (!role) return false;
  if (role === 'super_admin') return true;
  const list = rolePermissionsMap?.[role] ?? [];
  return list.includes(permission);
}
