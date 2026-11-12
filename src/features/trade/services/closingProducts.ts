import { supabase } from '@/api';
import type { ShiftClosingSummary } from './shiftClosingReport';

type ProductRow = {
  id: string; product_id: string | null; unit_name: string | null;
  quantity: number; unit_price: number; total: number | null;
  refunded_quantity: number | null; refunded_amount: number | null;
  product: { name?: string; name_en?: string } | null;
};

// Enrich only the exact sale cohort already authorized by the closing RPC.
// Bound URL size and page through line items; never scan the branch's history.
export async function loadClosingProducts(branchId: string, saleIds: string[]): Promise<ShiftClosingSummary['productsSold']> {
  const ids = [...new Set(saleIds.filter(Boolean))];
  const products = new Map<string, ShiftClosingSummary['productsSold'][number]>();
  for (let start = 0; start < ids.length; start += 100) {
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await supabase.from('sale_items')
        .select('id,sale_id,product_id,unit_name,quantity,unit_price,total,refunded_quantity,refunded_amount,product:products(name,name_en),sale:sales!inner(branch_id)')
        .eq('sale.branch_id', branchId)
        .in('sale_id', ids.slice(start, start + 100))
        .order('id')
        .range(offset, offset + 499);
      if (error) throw new Error(`DAY_REPORT_PRODUCTS_LOAD_FAILED: ${error.message}`);
      const rows = (data || []) as unknown as ProductRow[];
      for (const row of rows) {
        const unitName = row.unit_name || 'قطعة';
        const productId = row.product_id || `unlinked:${row.id}`;
        const key = JSON.stringify([productId, unitName]);
        const quantity = Math.max(0, Number(row.quantity || 0) - Number(row.refunded_quantity || 0));
        const total = Math.max(0, Number(row.total ?? Number(row.quantity || 0) * Number(row.unit_price || 0)) - Number(row.refunded_amount || 0));
        if (quantity <= 0 && total <= 0) continue;
        const product = products.get(key) || { productId, productName: row.product?.name || row.product?.name_en || unitName, unitName, quantity: 0, total: 0 };
        product.quantity += quantity;
        product.total += total;
        products.set(key, product);
      }
      if (rows.length < 500) break;
    }
  }
  return [...products.values()].sort((a, b) => a.productName.localeCompare(b.productName) || a.unitName.localeCompare(b.unitName));
}
