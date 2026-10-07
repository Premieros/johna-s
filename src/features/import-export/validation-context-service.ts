import { loadRawCurrentPrices, rawCurrentPriceMap } from '@/features/costing/services/rawCurrentPriceData';
import { supabase } from '@/api';
import type { ValidationContext } from './validation-engine';

type ImportExportValidationScope = {
  branchId?: string | null;
  role?: string | null;
};

export async function loadImportExportValidationContext(
  scope: ImportExportValidationScope,
): Promise<ValidationContext> {
  const [
    prodsRes,
    catsRes,
    compsRes,
    suppsRes,
    custsRes,
    whsRes,
    brsRes,
    usersRes,
    priceRows,
  ] = await Promise.all([
    Promise.resolve(supabase.from('products').select('*')).catch(() => ({ data: [], error: null })),
    Promise.resolve(supabase.from('categories').select('*')).catch(() => ({ data: [], error: null })),
    Promise.resolve(supabase.from('raw_materials').select('*')).catch(() => ({ data: [], error: null })),
    Promise.resolve(supabase.from('suppliers').select('*')).catch(() => ({ data: [], error: null })),
    Promise.resolve(supabase.from('customers').select('*')).catch(() => ({ data: [], error: null })),
    Promise.resolve(supabase.from('warehouses').select('*')).catch(() => ({ data: [], error: null })),
    Promise.resolve(supabase.from('branches').select('*')).catch(() => ({ data: [], error: null })),
    Promise.resolve(supabase.from('users').select('*')).catch(() => ({ data: [], error: null })),
    loadRawCurrentPrices(scope.branchId || null),
  ]);

  const isSuperAdmin = scope.role === 'super_admin';
  const userBranchId = scope.branchId || null;
  const branches = ((brsRes as { data: Array<{ id: string; code?: string; name: string }> })?.data || []) as Array<{ id: string; code?: string; name: string }>;
  const warehouses = ((whsRes as { data: Array<{ id: string; code?: string; name: string; branch_id?: string }> })?.data || []) as Array<{ id: string; code?: string; name: string; branch_id?: string }>;

  const allowedBranchIds = isSuperAdmin
    ? branches.map((branch) => branch.id)
    : userBranchId
      ? [userBranchId]
      : [];

  const allowedWarehouseIds = isSuperAdmin
    ? warehouses.map((warehouse) => warehouse.id)
    : warehouses
        .filter((warehouse) => !warehouse.branch_id || allowedBranchIds.includes(warehouse.branch_id))
        .map((warehouse) => warehouse.id);

  const products = ((prodsRes as { data: Record<string, unknown>[] })?.data || []);
  const categories = ((catsRes as { data: Record<string, unknown>[] })?.data || []);
  const components = ((compsRes as { data: Record<string, unknown>[] })?.data || []);
  const suppliers = ((suppsRes as { data: Record<string, unknown>[] })?.data || []);
  const customers = ((custsRes as { data: Record<string, unknown>[] })?.data || []);
  const users = ((usersRes as { data: Record<string, unknown>[] })?.data || []);

  const currentPrices = rawCurrentPriceMap(priceRows);
  return {
    existingProducts: products.map((product) => ({
      id: String(product.id || ''),
      sku: String(product.sku || product.name || ''),
      name: String(product.name || ''),
      barcode: product.barcode ? String(product.barcode) : undefined,
      category_id: product.category_id ? String(product.category_id) : undefined,
    })),
    existingCategories: categories.map((category) => ({
      id: String(category.id || ''),
      code: String(category.code || category.name || ''),
      name: String(category.name || ''),
      name_en: category.name_en ? String(category.name_en) : undefined,
    })),
    existingComponents: components.map((component) => ({
      id: String(component.id || ''),
      sku: String(component.code || component.sku || component.name || ''),
      name: String(component.name || ''),
      unit: String(component.unit || component.description || 'قطعة'),
      cost: currentPrices[String(component.id || '')] ?? 0,
    })),
    existingSuppliers: suppliers.map((supplier) => ({
      id: String(supplier.id || ''),
      code: supplier.code ? String(supplier.code) : undefined,
      name: String(supplier.name || ''),
      phone: supplier.phone ? String(supplier.phone) : undefined,
    })),
    existingCustomers: customers.map((customer) => ({
      id: String(customer.id || ''),
      code: customer.code ? String(customer.code) : undefined,
      name: String(customer.name || ''),
      phone: customer.phone ? String(customer.phone) : undefined,
    })),
    existingWarehouses: warehouses,
    existingBranches: branches,
    existingUsers: users.map((user) => ({
      id: String(user.id || ''),
      username: String(user.username || user.email || 'user'),
      email: user.email ? String(user.email) : undefined,
    })),
    userBranchId,
    isSuperAdmin,
    allowedBranchIds,
    allowedWarehouseIds,
  };
}
