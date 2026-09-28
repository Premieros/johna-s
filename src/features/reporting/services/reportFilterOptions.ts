import { supabase } from '@/api';

type ReportFilterOptionFlags = {
  warehouse: boolean;
  cashier: boolean;
  customer: boolean;
  supplier: boolean;
  product: boolean;
  category: boolean;
  table: boolean;
};

type ReportFilterOptions = {
  warehouses: unknown[];
  cashiers: unknown[];
  customers: unknown[];
  suppliers: unknown[];
  products: unknown[];
  categories: unknown[];
  tables: unknown[];
};

export async function loadReportFilterOptions(branchId: string, flags: ReportFilterOptionFlags): Promise<ReportFilterOptions> {
  const [warehouses, cashiers, customers, suppliers, products, categories, tables] = await Promise.all([
    flags.warehouse
      ? supabase.from('warehouses').select('id, name').eq('branch_id', branchId)
      : Promise.resolve({ data: [] }),
    flags.cashier
      ? supabase.from('users').select('id, full_name, email').eq('branch_id', branchId)
      : Promise.resolve({ data: [] }),
    flags.customer
      ? supabase.from('customers').select('id, name, name_en').eq('branch_id', branchId)
      : Promise.resolve({ data: [] }),
    flags.supplier
      ? supabase.from('suppliers').select('id, name, name_en').eq('branch_id', branchId)
      : Promise.resolve({ data: [] }),
    flags.product
      ? supabase.from('products').select('id, name, name_en').eq('branch_id', branchId)
      : Promise.resolve({ data: [] }),
    flags.category
      ? supabase.from('categories').select('id, name, name_en').eq('branch_id', branchId)
      : Promise.resolve({ data: [] }),
    flags.table
      ? supabase.from('dining_tables').select('id, name').eq('branch_id', branchId)
      : Promise.resolve({ data: [] }),
  ]);

  return {
    warehouses: warehouses.data || [],
    cashiers: cashiers.data || [],
    customers: customers.data || [],
    suppliers: suppliers.data || [],
    products: products.data || [],
    categories: categories.data || [],
    tables: tables.data || [],
  };
}

export async function loadExpenseCategoryOptions(branchId: string): Promise<string[]> {
  const { data } = await supabase.from('expenses').select('category').eq('branch_id', branchId);
  return Array.from(
    new Set((data || []).map((row) => String((row as Record<string, unknown>).category || '')).filter(Boolean)),
  );
}
