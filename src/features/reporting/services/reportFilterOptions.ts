import { supabase } from '@/api';

type ReportFilterOptionFlags = {
  raw_material?: boolean;
  material_category?: boolean;
  station?: boolean;
  warehouse: boolean;
  cashier: boolean;
  customer: boolean;
  supplier: boolean;
  product: boolean;
  category: boolean;
  table: boolean;
};

export type ReportFilterOptions = {
  rawMaterials?: { id: string; name: string; category: string | null }[];
  stations: { id: string; name_ar: string; name_en: string | null }[];
  warehouses: { id: string; name: string }[];
  cashiers: { id: string; full_name: string | null; email: string | null }[];
  customers: { id: string; name: string; name_en: string | null }[];
  suppliers: { id: string; name: string; name_en: string | null }[];
  products: { id: string; name: string; name_en: string | null }[];
  categories: { id: string; name: string; name_en: string | null }[];
  tables: { id: string; name: string }[];
};

export async function loadReportFilterOptions(branchId: string | string[], flags: ReportFilterOptionFlags): Promise<ReportFilterOptions> {
  const [warehouses, cashiers, customers, suppliers, products, categories, tables, stations, rawMaterials] = await Promise.all([
    flags.warehouse
      ? supabase.from('warehouses').select('id, name').in('branch_id', typeof branchId === 'string' ? [branchId] : branchId)
      : Promise.resolve({ data: [], error: null }),
    flags.cashier
      ? supabase.from('users').select('id, full_name, email').in('branch_id', typeof branchId === 'string' ? [branchId] : branchId)
      : Promise.resolve({ data: [], error: null }),
    flags.customer
      ? supabase.from('customers').select('id, name, name_en').in('branch_id', typeof branchId === 'string' ? [branchId] : branchId)
      : Promise.resolve({ data: [], error: null }),
    flags.supplier
      ? supabase.from('suppliers').select('id, name, name_en').in('branch_id', typeof branchId === 'string' ? [branchId] : branchId)
      : Promise.resolve({ data: [], error: null }),
    flags.product
      ? supabase.from('products').select('id, name, name_en').in('branch_id', typeof branchId === 'string' ? [branchId] : branchId)
      : Promise.resolve({ data: [], error: null }),
    flags.category
      ? supabase.from('categories').select('id, name, name_en').in('branch_id', typeof branchId === 'string' ? [branchId] : branchId)
      : Promise.resolve({ data: [], error: null }),
    flags.table
      ? supabase.from('dining_tables').select('id, name').in('branch_id', typeof branchId === 'string' ? [branchId] : branchId)
      : Promise.resolve({ data: [], error: null }),
    flags.station
      ? supabase.from('kitchen_stations').select('id,name_ar,name_en').in('branch_id', typeof branchId === 'string' ? [branchId] : branchId).order('sort_order')
      : Promise.resolve({ data: [], error: null }),
    flags.raw_material || flags.material_category
      ? supabase.from('raw_materials').select('id,name,category').in('branch_id', typeof branchId === 'string' ? [branchId] : branchId)
      : Promise.resolve({ data: [], error: null }),
  ]);

  for (const result of [warehouses, cashiers, customers, suppliers, products, categories, tables, stations, rawMaterials]) {
    if (result.error) throw result.error;
  }

  return {
    rawMaterials: (rawMaterials.data || []) as NonNullable<ReportFilterOptions['rawMaterials']>,
    stations: (stations.data || []) as ReportFilterOptions['stations'],
    warehouses: (warehouses.data || []) as ReportFilterOptions['warehouses'],
    cashiers: (cashiers.data || []) as ReportFilterOptions['cashiers'],
    customers: (customers.data || []) as ReportFilterOptions['customers'],
    suppliers: (suppliers.data || []) as ReportFilterOptions['suppliers'],
    products: (products.data || []) as ReportFilterOptions['products'],
    categories: (categories.data || []) as ReportFilterOptions['categories'],
    tables: (tables.data || []) as ReportFilterOptions['tables'],
  };
}

export async function loadExpenseCategoryOptions(branchId: string | string[]): Promise<string[]> {
  const { data, error } = await supabase.from('expenses').select('category').in('branch_id', typeof branchId === 'string' ? [branchId] : branchId);
  if (error) throw error;
  return Array.from(
    new Set((data || []).map((row) => String((row as Record<string, unknown>).category || '')).filter(Boolean)),
  );
}
