import { supabase } from '@/api';
import type { ShiftClosingSummary } from './shiftClosingReport';

type ShiftOperationRow = {
  operation_type: string;
  amount: number;
  payment_method: string | null;
  reference_type: string | null;
  reference_id: string | null;
};

type SaleRow = {
  id: string;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  total: number;
  paid_amount: number;
  refunded_amount: number | null;
  payment_method: string;
  order_type: string;
  customer?: { employee_user_id?: string | null } | null;
  sale_items?: Array<{
    product_id: string;
    unit_name?: string;
    quantity: number;
    unit_price: number;
    total: number;
    product?: { name?: string; name_en?: string };
  }>;
};

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'نقدي (Cash)',
  card: 'بطاقة / ائتمان (Card)',
  transfer: 'تحويل / محفظة (Transfer)',
  bank_transfer: 'تحويل بنكي (Bank Transfer)',
  instapay: 'إنستاباي / محفظة (InstaPay)',
  credit: 'آجل عملاء (Customer Credit)',
  employee_credit: 'آجل موظفين (Employee Credit)',
};

const ORDER_LABELS: Record<string, string> = {
  dine_in: 'صالة (Dine-in)',
  takeaway: 'سفري / تيك أواي (Takeaway)',
  delivery: 'توصيل (Delivery)',
  drive_thru: 'خدمة السيارات (Drive-thru)',
};

/**
 * Authoritative shift closing reader.
 * A shift is linked to sales through shift_operations.reference_id; `sales`
 * deliberately has no shift_id column. Physical tenders are derived from the
 * recorded shift movements. Receivables are derived from the linked sale open
 * amount and never counted as drawer cash. Employee credit remains the standard
 * customer-credit flow and is classified only by customers.employee_user_id.
 */
export async function fetchShiftClosingDetailsSafe(shiftId: string, branchId?: string): Promise<ShiftClosingSummary> {
  const { data: shift, error: shiftErr } = await supabase
    .from('shifts')
    .select('*')
    .eq('id', shiftId)
    .single();
  if (shiftErr || !shift) throw new Error(shiftErr?.message || 'Shift not found');

  const effectiveBranchId = shift.branch_id || branchId || '';
  const [branchRes, cashierRes, operationsRes] = await Promise.all([
    effectiveBranchId
      ? supabase.from('branches').select('name,name_en').eq('id', effectiveBranchId).maybeSingle()
      : Promise.resolve({ data: null }),
    shift.cashier_id
      ? supabase.from('users').select('full_name,email').eq('id', shift.cashier_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('shift_operations')
      .select('operation_type,amount,payment_method,reference_type,reference_id')
      .eq('shift_id', shiftId),
  ]);

  if (operationsRes.error) throw new Error(operationsRes.error.message);
  const operations = (operationsRes.data || []) as ShiftOperationRow[];
  const saleIds = Array.from(new Set(
    operations
      .filter((op) => op.reference_type === 'sale' && op.reference_id)
      .map((op) => op.reference_id as string),
  ));

  let salesList: SaleRow[] = [];
  if (saleIds.length > 0) {
    const { data: sales, error: salesErr } = await supabase
      .from('sales')
      .select('id,subtotal,discount_amount,tax_amount,total,paid_amount,refunded_amount,payment_method,order_type,customer:customers(employee_user_id),sale_items(product_id,unit_name,quantity,unit_price,total,product:products(name,name_en))')
      .eq('branch_id', effectiveBranchId)
      .in('id', saleIds);
    if (salesErr) throw new Error(salesErr.message);
    salesList = (sales || []) as unknown as SaleRow[];
  }

  let grossSales = 0;
  let totalDiscounts = 0;
  let totalTaxes = 0;
  let netSales = 0;
  const paymentMap = new Map<string, { count: number; total: number }>();
  const orderTypeMap = new Map<string, { count: number; total: number }>();
  const productMap = new Map<string, { name: string; quantity: number; unitName: string; total: number }>();

  for (const op of operations) {
    if (!op.payment_method) continue;
    if (op.operation_type !== 'sale' && op.operation_type !== 'refund') continue;
    if (op.payment_method === 'credit') continue;
    const signed = op.operation_type === 'refund' ? -Number(op.amount || 0) : Number(op.amount || 0);
    const current = paymentMap.get(op.payment_method) || { count: 0, total: 0 };
    current.count += 1;
    current.total += signed;
    paymentMap.set(op.payment_method, current);
  }

  for (const sale of salesList) {
    grossSales += Number(sale.subtotal || sale.total || 0);
    totalDiscounts += Number(sale.discount_amount || 0);
    totalTaxes += Number(sale.tax_amount || 0);
    netSales += Number(sale.total || 0);

    const openAmount = Math.max(
      0,
      Number(sale.total || 0) - Number(sale.paid_amount || 0) - Number(sale.refunded_amount || 0),
    );
    if (openAmount > 0.009) {
      const method = sale.customer?.employee_user_id ? 'employee_credit' : 'credit';
      const current = paymentMap.get(method) || { count: 0, total: 0 };
      current.count += 1;
      current.total += openAmount;
      paymentMap.set(method, current);
    }

    const orderType = sale.order_type || 'takeaway';
    const order = orderTypeMap.get(orderType) || { count: 0, total: 0 };
    order.count += 1;
    order.total += Number(sale.total || 0);
    orderTypeMap.set(orderType, order);

    for (const item of sale.sale_items || []) {
      const id = item.product_id || 'unknown';
      const name = item.product?.name || item.product?.name_en || 'منتج';
      const current = productMap.get(id) || { name, quantity: 0, unitName: item.unit_name || 'قطعة', total: 0 };
      current.quantity += Number(item.quantity || 0);
      current.total += Number(item.total || item.quantity * item.unit_price || 0);
      productMap.set(id, current);
    }
  }

  const ingredientsMap = new Map<string, { name: string; quantity: number; unit: string; estimatedCost: number }>();
  const productIds = Array.from(productMap.keys()).filter((id) => id !== 'unknown');
  if (effectiveBranchId && productIds.length > 0) {
    const { data: recipes, error: recipesError } = await supabase
      .from('recipes')
      .select('product_id,yield_quantity,recipe_items(raw_material_id,quantity,wastage_percent,raw_material:raw_materials(name,default_cost,measurement_unit:measurement_units!raw_materials_unit_id_fkey(name,symbol,code)))')
      .eq('branch_id', effectiveBranchId)
      .in('product_id', productIds);
    if (recipesError) throw new Error(recipesError.message);

    for (const recipe of recipes || []) {
      const sold = productMap.get(recipe.product_id);
      if (!sold) continue;
      const multiplier = sold.quantity / (Number(recipe.yield_quantity) || 1);
      for (const recipeItem of recipe.recipe_items || []) {
        const raw = recipeItem.raw_material as { name?: string; default_cost?: number; measurement_unit?: { name?: string; symbol?: string; code?: string } } | null;
        const id = recipeItem.raw_material_id;
        const consumed = Number(recipeItem.quantity || 0) * multiplier * (1 + Number(recipeItem.wastage_percent || 0) / 100);
        const current = ingredientsMap.get(id) || {
          name: raw?.name || 'مادة خام',
          quantity: 0,
          unit: raw?.measurement_unit?.symbol || raw?.measurement_unit?.code || raw?.measurement_unit?.name || '',
          estimatedCost: 0,
        };
        current.quantity += consumed;
        current.estimatedCost += consumed * Number(raw?.default_cost || 0);
        ingredientsMap.set(id, current);
      }
    }
  }

  const totalInvoices = salesList.length;
  return {
    shiftId: shift.id,
    branchId: effectiveBranchId,
    branchName: branchRes.data?.name || branchRes.data?.name_en || 'الفرع الرئيسي',
    cashierName: cashierRes.data?.full_name || cashierRes.data?.email || 'كاشير',
    openedAt: shift.opened_at,
    closedAt: shift.closed_at || null,
    openingAmount: Number(shift.opening_amount || 0),
    expectedAmount: Number(shift.expected_amount || shift.opening_amount || 0),
    actualAmount: Number(shift.actual_amount || 0),
    difference: Number(shift.difference || 0),
    notes: shift.notes || null,
    totalInvoices,
    grossSales,
    totalDiscounts,
    totalTaxes,
    netSales,
    avgTicket: totalInvoices > 0 ? netSales / totalInvoices : 0,
    orderTypes: Array.from(orderTypeMap, ([type, data]) => ({ type, label: ORDER_LABELS[type] || type, ...data })),
    paymentMethods: Array.from(paymentMap, ([method, data]) => ({ method, label: PAYMENT_LABELS[method] || method, ...data })),
    productsSold: Array.from(productMap, ([productId, data]) => ({ productId, productName: data.name, quantity: data.quantity, unitName: data.unitName, total: data.total })),
    ingredientsConsumed: Array.from(ingredientsMap, ([materialId, data]) => ({ materialId, materialName: data.name, quantity: Number(data.quantity.toFixed(3)), unit: data.unit, estimatedCost: Number(data.estimatedCost.toFixed(2)) })),
  };
}
