import { supabase, shifts as shiftsApi, costing as costingApi } from '@/api';
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

export async function fetchShiftClosingReportServer(shiftId: string): Promise<ShiftClosingSummary> {
  const [reportRes, tenderRes] = await Promise.all([
    supabase.rpc('get_shift_closing_report', { p_shift_id: shiftId }),
    shiftsApi.getSaleTenders({ p_shift_id: shiftId }),
  ]);
  if (reportRes.error) throw new Error(reportRes.error.message);
  const raw = reportRes.data as Record<string, unknown> | null;
  if (!raw?.success) throw new Error(String(raw?.detail || raw?.error || 'Could not load shift closing report'));

  const tenderRaw = (tenderRes.data as Record<string, unknown> | null) || null;
  const tenderBySale = new Map<string, Array<{ method: string; amount: number }>>();
  if (!tenderRes.error && tenderRaw?.success && Array.isArray(tenderRaw.sales)) {
    for (const row of tenderRaw.sales) {
      const item = row as Record<string, unknown>;
      const saleId = String(item.sale_id || '');
      const payments = Array.isArray(item.payments)
        ? item.payments.map((payment) => {
          const p = payment as Record<string, unknown>;
          return { method: String(p.method || 'cash'), amount: Number(p.amount || 0) };
        })
        : [];
      if (saleId) tenderBySale.set(saleId, payments);
    }
  }

  const paymentSource = !tenderRes.error && tenderRaw?.success && Array.isArray(tenderRaw.payment_methods)
    ? tenderRaw.payment_methods
    : raw.payment_methods;
  const paymentMethods = Array.isArray(paymentSource)
    ? paymentSource.map((row) => {
      const item = row as Record<string, unknown>;
      const method = String(item.method || 'cash');
      return { method, label: PAYMENT_LABELS[method] || method, count: Number(item.count || 0), total: Number(item.total || 0) };
    })
    : [];
  const userReports = Array.isArray(raw.users)
    ? raw.users.map((row) => {
      const item = row as Record<string, unknown>;
      return {
        userId: String(item.user_id || ''),
        displayName: String(item.display_name || ''),
        salesTotal: Number(item.sales_total || 0),
        invoiceCount: Number(item.invoice_count || 0),
        discounts: Number(item.discounts || 0),
        returns: Number(item.returns || 0),
        expenses: Number(item.expenses || 0),
        netContribution: Number(item.net_contribution || 0),
        sales: Array.isArray(item.sales) ? item.sales.map((sale) => {
          const s = sale as Record<string, unknown>;
          return {
            invoiceNumber: String(s.invoice_number || ''),
            total: Number(s.total || 0),
            paymentMethod: String(s.payment_method || ''),
            createdAt: String(s.created_at || ''),
          };
        }) : [],
        expenseDetails: Array.isArray(item.expenses_detail) ? item.expenses_detail.map((expense) => {
          const e = expense as Record<string, unknown>;
          return {
            category: String(e.category || ''),
            description: String(e.description || ''),
            amount: Number(e.amount || 0),
            paymentMethod: String(e.payment_method || ''),
            createdAt: String(e.created_at || ''),
          };
        }) : [],
        returnDetails: Array.isArray(item.returns_detail) ? item.returns_detail.map((ret) => {
          const r = ret as Record<string, unknown>;
          return {
            amount: Number(r.amount || 0),
            paymentMethod: String(r.payment_method || ''),
            createdAt: String(r.created_at || ''),
          };
        }) : [],
      };
    })
    : [];
  const expenseDetails = Array.isArray(raw.expense_details)
    ? raw.expense_details.map((row) => {
      const item = row as Record<string, unknown>;
      return {
        expenseId: String(item.expense_id || ''),
        category: String(item.category || ''),
        description: String(item.description || ''),
        amount: Number(item.amount || 0),
        paymentMethod: String(item.payment_method || 'cash'),
        expenseDate: String(item.expense_date || ''),
        notes: item.notes ? String(item.notes) : null,
        createdAt: String(item.created_at || ''),
        createdBy: String(item.created_by || ''),
        createdByName: String(item.created_by_name || ''),
      };
    })
    : [];
  const salesDetails = Array.isArray(raw.sales_details)
    ? raw.sales_details.map((row) => {
      const item = row as Record<string, unknown>;
      return {
        saleId: String(item.sale_id || ''),
        invoiceNumber: String(item.invoice_number || ''),
        orderNumber: '',
        userId: String(item.user_id || ''),
        userName: String(item.user_name || ''),
        subtotal: Number(item.subtotal || 0),
        discountAmount: Number(item.discount_amount || 0),
        taxAmount: Number(item.tax_amount || 0),
        total: Number(item.total || 0),
        paidAmount: Number(item.paid_amount || 0),
        refundedAmount: Number(item.refunded_amount || 0),
        paymentMethod: String(item.payment_method || ''),
        payments: tenderBySale.get(String(item.sale_id || '')) || [],
        orderType: String(item.order_type || ''),
        createdAt: String(item.created_at || ''),
      };
    })
    : [];

  const traceSaleIds = Array.from(new Set(salesDetails.map((sale) => sale.saleId).filter(Boolean)));
  if (traceSaleIds.length > 0) {
    const { data: traceRows, error: traceError } = await supabase
      .from('sales')
      .select('id,source_order:orders!sales_source_order_id_fkey(order_number)')
      .in('id', traceSaleIds);
    if (traceError) throw new Error(`SHIFT_REPORT_ORDER_TRACE_LOAD_FAILED: ${traceError.message}`);

    const orderBySale = new Map<string, string>();
    for (const row of traceRows || []) {
      const sourceOrder = row.source_order as unknown as { order_number?: string } | null;
      if (sourceOrder?.order_number) orderBySale.set(String(row.id), String(sourceOrder.order_number));
    }
    for (const sale of salesDetails) {
      sale.orderNumber = orderBySale.get(sale.saleId) || '';
    }
  }

  const cashPurchaseDetails: NonNullable<ShiftClosingSummary['cashPurchaseDetails']> = [];
  if (raw.branch_id && raw.opened_at) {
    const endAt = raw.closed_at ? String(raw.closed_at) : new Date().toISOString();
    const { data: purchaseRows, error: purchaseError } = await supabase
      .from('purchases')
      .select('id,invoice_number,paid_amount,returned_amount,payment_method,status,created_at')
      .eq('branch_id', String(raw.branch_id))
      .eq('payment_method', 'cash')
      .in('status', ['completed', 'returned'])
      .gte('created_at', String(raw.opened_at))
      .lte('created_at', endAt)
      .order('created_at', { ascending: true });
    if (purchaseError) throw new Error(`SHIFT_REPORT_CASH_PURCHASES_LOAD_FAILED: ${purchaseError.message}`);

    for (const row of purchaseRows || []) {
      const cashOutflow = Math.max(0, Number(row.paid_amount || 0) - Number(row.returned_amount || 0));
      if (cashOutflow <= 0) continue;
      cashPurchaseDetails.push({
        purchaseId: String(row.id),
        invoiceNumber: String(row.invoice_number || ''),
        amount: cashOutflow,
        createdAt: String(row.created_at || ''),
      });
    }
  }
  const cashPurchases = cashPurchaseDetails.reduce((sum, purchase) => sum + purchase.amount, 0);

  const treasuryBalances = Array.isArray(raw.treasury)
    ? raw.treasury.map((row) => {
      const item = row as Record<string, unknown>;
      return {
        accountId: String(item.account_id || ''),
        accountName: String(item.account_name || ''),
        openingBalance: Number(item.opening_balance || 0),
        glBalance: Number(item.gl_balance || 0),
      };
    })
    : [];

  // The authoritative RPC owns shift membership and financial totals, but it
  // deliberately returns sale headers only. Enrich the report from those
  // already-authorized sale ids so product / recipe sections cannot silently
  // degrade to empty arrays.
  const orderTypeMap = new Map<string, { count: number; total: number }>();
  for (const sale of salesDetails) {
    const type = sale.orderType || 'takeaway';
    const current = orderTypeMap.get(type) || { count: 0, total: 0 };
    current.count += 1;
    current.total += Number(sale.total || 0);
    orderTypeMap.set(type, current);
  }

  const productMap = new Map<string, { name: string; quantity: number; unitName: string; total: number }>();
  const saleIds = Array.from(new Set(salesDetails.map((sale) => sale.saleId).filter(Boolean)));
  if (saleIds.length > 0) {
    const { data: saleItems, error: saleItemsError } = await supabase
      .from('sale_items')
      .select('sale_id,product_id,unit_name,quantity,unit_price,total,refunded_quantity,refunded_amount,product:products(name,name_en)')
      .in('sale_id', saleIds);
    if (saleItemsError) throw new Error(`SHIFT_REPORT_ITEMS_LOAD_FAILED: ${saleItemsError.message}`);

    const itemRows = (saleItems || []) as unknown as Array<{
      sale_id: string;
      product_id: string | null;
      unit_name?: string | null;
      quantity: number;
      unit_price: number;
      total: number;
      refunded_quantity?: number | null;
      refunded_amount?: number | null;
      product?: { name?: string; name_en?: string } | null;
    }>;

    for (const item of itemRows) {
      const productId = item.product_id || `unlinked:${item.unit_name || 'item'}`;
      const productName = item.product?.name || item.product?.name_en || item.unit_name || 'منتج';
      const current = productMap.get(productId) || {
        name: productName,
        quantity: 0,
        unitName: item.unit_name || 'قطعة',
        total: 0,
      };
      const netQuantity = Math.max(0, Number(item.quantity || 0) - Number(item.refunded_quantity || 0));
      const grossLineTotal = Number(item.total || (Number(item.quantity || 0) * Number(item.unit_price || 0)));
      const netLineTotal = Math.max(0, grossLineTotal - Number(item.refunded_amount || 0));
      if (netQuantity <= 0 && netLineTotal <= 0) continue;
      current.quantity += netQuantity;
      current.total += netLineTotal;
      productMap.set(productId, current);
    }
  }

  const ingredientsConsumed: ShiftClosingSummary['ingredientsConsumed'] = [];
  if (raw.branch_id && raw.opened_at) {
    const rawEndAt = raw.closed_at ? String(raw.closed_at) : new Date().toISOString();
    const { data: rawCostRows, error: rawCostError } = await costingApi.getRawConsumptionCostBreakdown({
      p_branch_id: String(raw.branch_id),
      p_from: String(raw.opened_at),
      p_to: rawEndAt,
    });
    if (rawCostError) throw new Error(`SHIFT_REPORT_RAW_COST_LOAD_FAILED: ${rawCostError.message}`);

    for (const row of (rawCostRows || []) as Array<Record<string, unknown>>) {
      ingredientsConsumed.push({
        materialId: String(row.raw_material_id || ''),
        materialName: String(row.raw_material_name || 'مادة خام'),
        quantity: Number(row.consumed_quantity || 0),
        unit: String(row.unit_name || ''),
        actualQuantity: Number(row.actual_quantity || 0),
        estimatedQuantity: Number(row.estimated_quantity || 0),
        actualCost: Number(row.actual_cost || 0),
        estimatedCost: Number(row.estimated_cost || 0),
        displayedCost: Number(row.displayed_cost || 0),
      });
    }
  }

  return {
    shiftId,
    branchId: String(raw.branch_id || ''),
    branchName: String(raw.branch_name || ''),
    cashierName: String(raw.cashier_name || ''),
    openedAt: String(raw.opened_at || ''),
    closedAt: raw.closed_at ? String(raw.closed_at) : null,
    openingAmount: Number(raw.opening_amount || 0),
    expectedAmount: Number(raw.expected_cash || 0),
    actualAmount: Number(raw.actual_cash || 0),
    difference: Number(raw.difference || 0),
    notes: raw.notes ? String(raw.notes) : null,
    totalInvoices: Number(raw.invoice_count || 0),
    grossSales: Number(raw.gross_sales || 0),
    totalDiscounts: Number(raw.discounts || 0),
    returns: Number(raw.returns || 0),
    voids: Number(raw.voids || 0),
    expenses: Number(raw.expenses || 0),
    cashPurchases,
    cashPurchaseDetails,
    netRevenue: Number(raw.net_revenue || 0),
    totalTaxes: Number(raw.taxes || 0),
    netSales: Number(raw.net_sales || 0),
    avgTicket: Number(raw.invoice_count || 0) > 0 ? Number(raw.net_revenue || 0) / Number(raw.invoice_count) : 0,
    orderTypes: Array.from(orderTypeMap, ([type, data]) => ({
      type,
      label: ORDER_LABELS[type] || type,
      count: data.count,
      total: data.total,
    })),
    paymentMethods,
    productsSold: Array.from(productMap, ([productId, data]) => ({
      productId,
      productName: data.name,
      quantity: data.quantity,
      unitName: data.unitName,
      total: data.total,
    })),
    ingredientsConsumed,
    userReports,
    treasuryBalances,
    expenseDetails,
    salesDetails,
  };
}

function calculateExpectedDrawerAmount(openingAmount: number, operations: ShiftOperationRow[]) {
  const expected = operations.reduce((total, op) => {
    if ((op.payment_method || 'cash') !== 'cash') return total;
    const amount = Number(op.amount || 0);
    if (op.operation_type === 'sale' || op.operation_type === 'cash_in') return total + amount;
    if (op.operation_type === 'refund' || op.operation_type === 'expense' || op.operation_type === 'cash_out') return total - amount;
    return total;
  }, openingAmount);
  return Number(expected.toFixed(2));
}

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
  const openingAmount = Number(shift.opening_amount || 0);
  const liveExpectedAmount = calculateExpectedDrawerAmount(openingAmount, operations);
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

  const ingredientsConsumed: ShiftClosingSummary['ingredientsConsumed'] = [];
  if (effectiveBranchId && shift.opened_at) {
    const rawEndAt = shift.closed_at ? String(shift.closed_at) : new Date().toISOString();
    const { data: rawCostRows, error: rawCostError } = await costingApi.getRawConsumptionCostBreakdown({
      p_branch_id: effectiveBranchId,
      p_from: String(shift.opened_at),
      p_to: rawEndAt,
    });
    if (rawCostError) throw new Error(`SHIFT_REPORT_RAW_COST_LOAD_FAILED: ${rawCostError.message}`);
    for (const row of (rawCostRows || []) as Array<Record<string, unknown>>) {
      ingredientsConsumed.push({
        materialId: String(row.raw_material_id || ''),
        materialName: String(row.raw_material_name || 'مادة خام'),
        quantity: Number(row.consumed_quantity || 0),
        unit: String(row.unit_name || ''),
        actualQuantity: Number(row.actual_quantity || 0),
        estimatedQuantity: Number(row.estimated_quantity || 0),
        actualCost: Number(row.actual_cost || 0),
        estimatedCost: Number(row.estimated_cost || 0),
        displayedCost: Number(row.displayed_cost || 0),
      });
    }
  }

  const totalInvoices = salesList.length;
  const expectedAmount = shift.status === 'open'
    ? liveExpectedAmount
    : Number(shift.expected_amount ?? liveExpectedAmount);
  return {
    shiftId: shift.id,
    branchId: effectiveBranchId,
    branchName: branchRes.data?.name || branchRes.data?.name_en || 'الفرع الرئيسي',
    cashierName: cashierRes.data?.full_name || cashierRes.data?.email || 'كاشير',
    openedAt: shift.opened_at,
    closedAt: shift.closed_at || null,
    openingAmount,
    expectedAmount,
    actualAmount: Number(shift.actual_amount || 0),
    difference: Number(shift.difference || 0),
    notes: shift.notes || null,
    totalInvoices,
    grossSales,
    totalDiscounts,
    returns: 0,
    voids: 0,
    expenses: 0,
    netRevenue: netSales,
    totalTaxes,
    netSales,
    avgTicket: totalInvoices > 0 ? netSales / totalInvoices : 0,
    orderTypes: Array.from(orderTypeMap, ([type, data]) => ({ type, label: ORDER_LABELS[type] || type, ...data })),
    paymentMethods: Array.from(paymentMap, ([method, data]) => ({ method, label: PAYMENT_LABELS[method] || method, ...data })),
    productsSold: Array.from(productMap, ([productId, data]) => ({ productId, productName: data.name, quantity: data.quantity, unitName: data.unitName, total: data.total })),
    ingredientsConsumed,
  };
}