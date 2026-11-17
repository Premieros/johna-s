import { ALL_PERMISSIONS, type Permission } from './permissionDefs';

/**
 * The feature registry is the canonical module taxonomy. This mapping is
 * intentionally explicit: no unknown permission inherits a module gate.
 * Keep in sync with _permission_feature_key in the SQL migration.
 */
export function permissionFeatureKey(permission: Permission | string): string | null {
  if (permission.startsWith('pos.kds_')) return 'kds';
  if (permission === 'pos.order.delivery') return 'delivery';
  if (permission.startsWith('pos.')) return 'pos';
  if (permission.startsWith('floor_plan.')) return 'tables';
  if (permission.startsWith('inventory.count.')) return 'stock_counts';
  if (permission.startsWith('inventory.transfer.')) return 'transfers';
  if (permission.startsWith('inventory.')) return 'inventory';
  if (permission.startsWith('raw_materials.') || permission.startsWith('components.')) return 'inventory';
  if (permission.startsWith('warehouses.')) return 'warehouse_management';
  if (permission.startsWith('recipes.')) return 'recipes';
  if (permission.startsWith('production.')) return 'manufacturing';
  if (permission.startsWith('waste.')) return 'waste_management';
  if (permission.startsWith('purchases.') || permission.startsWith('procurement.')) return 'purchases';
  if (permission.startsWith('customers.')) return 'customers';
  if (permission.startsWith('suppliers.')) return 'suppliers';
  if (permission === 'reports.costing') return 'costing';
  if (permission === 'reports.financial') return 'advanced_reports';
  if (permission.startsWith('reports.')) return 'reports';
  if (permission.startsWith('accounts.') || permission.startsWith('accounting.') || permission.startsWith('expenses.')) return 'accounting';
  if (permission.startsWith('shifts.')) return 'shift_management';
  if (permission.startsWith('audit.')) return 'audit_logs';
  if (permission.startsWith('roles.')) return 'advanced_permissions';
  if (permission.startsWith('branches.')) return 'branch_management';
  if (permission.startsWith('users.')) return 'employees';
  if (permission.startsWith('sales.') || permission.startsWith('refunds.')) return 'pos';
  return null;
}

/** Only modules with an actual permission gate may be edited in Super Admin. */
export const ENFORCED_ORGANIZATION_MODULE_KEYS: ReadonlySet<string> = new Set(
  ALL_PERMISSIONS.map(permissionFeatureKey).filter((key): key is string => key !== null)
);
