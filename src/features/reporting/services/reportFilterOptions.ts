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

export type ReportFilterOptions = {
  warehouses: { id: string; name: string }[];
  cashiers: { id: string; full_name: string | null; email: string | null }[];
  customers: { id: string; name: string; name_en: string | null }[];
  suppliers: { id: string; name: string; name_en: string | null }[];
  products: { id: string; name: string; name_en: string | null }[];
  categories: { id: string; name: string; name_en: string | null }[];
  tables: { id: string; name: string }[];
};

export async function loadReportFilterOptions(branchId: string, flags: ReportFilterOptionFlags): Promise<ReportFilterOptions> {
  const [warehouses, cashiers, customers, suppliers, products, categories, tables] = await Promise.all([
    flags.warehouse
      ? supabase.from('warehouses').select('id, name').eq('branch_id', branchId)
      : Promise.resolve({ data: [], error: null }),
    flags.cashier
      ? supabase.from('users').select('id, full_name, email').eq('branch_id', branchId)
      : Promise.resolve({ data: [], error: null }),
    flags.customer
      ? supabase.from('customers').select('id, name, name_en').eq('branch_id', branchId)
      : Promise.resolve({ data: [], error: null }),
    flags.supplier
      ? supabase.from('suppliers').select('id, name, name_en').eq('branch_id', branchId)
      : Promise.resolve({ data: [], error: null }),
    flags.product
      ? supabase.from('products').select('id, name, name_en').eq('branch_id', branchId)
      : Promise.resolve({ data: [], error: null }),
    flags.category
      ? supabase.from('categories').select('id, name, name_en').eq('branch_id', branchId)
      : Promise.resolve({ data: [], error: null }),
    flags.table
      ? supabase.from('dining_tables').select('id, name').eq('branch_id', branchId)
      : Promise.resolve({ data: [], error: null }),
  ]);

  for (const result of [warehouses, cashiers, customers, suppliers, products, categories, tables]) {
    if (result.error) throw result.error;
  }

  return {
    warehouses: (warehouses.data || []) as ReportFilterOptions['warehouses'],
    cashiers: (cashiers.data || []) as ReportFilterOptions['cashiers'],
    customers: (customers.data || []) as ReportFilterOptions['customers'],
    suppliers: (suppliers.data || []) as ReportFilterOptions['suppliers'],
    products: (products.data || []) as ReportFilterOptions['products'],
    categories: (categories.data || []) as ReportFilterOptions['categories'],
    tables: (tables.data || []) as ReportFilterOptions['tables'],
  };
}

export async function loadExpenseCategoryOptions(branchId: string): Promise<string[]> {
  const { data, error } = await supabase.from('expenses').select('category').eq('branch_id', branchId);
  if (error) throw error;
  return Array.from(
    new Set((data || []).map((row) => String((row as Record<string, unknown>).category || '')).filter(Boolean)),
  );
}
