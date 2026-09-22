import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');

const migration = read('supabase/migrations/20260922184000_shift_cash_purchase_sale_trace.sql');
const shiftModal = read('src/features/pos/components/shift/ShiftModal.tsx');
const salesPage = read('src/features/trade/pages/SalesPage.tsx');
const shiftFinancials = read('src/features/trade/services/shiftClosingFinancials.ts');
const shiftReport = read('src/features/trade/services/shiftClosingReport.ts');

describe('shift close, sale trace and cash outflow repair', () => {
  it('keeps invoice numbering independent while persisting the original POS order trace', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS source_order_id uuid');
    expect(migration).toContain('sales_source_order_id_fkey');
    expect(migration).toContain('order_kitchen_inventory_events');
    expect(migration).toContain('trg_sync_sale_source_order_from_kitchen_event');
    expect(salesPage).toContain('source_order:orders!sales_source_order_id_fkey(order_number)');
    expect(salesPage).toContain("isAr ? 'الطلب' : 'Order'");
    expect(shiftFinancials).toContain('SHIFT_REPORT_ORDER_TRACE_LOAD_FAILED');
    expect(shiftReport).toContain('orderNumber?: string');
  });

  it('does not report a failed shift-close RPC as success and exposes the permitted open-order override', () => {
    expect(shiftModal).toContain('const { data, error } = await api.shifts.close');
    expect(shiftModal).toContain("result?.error === 'OPEN_ORDERS_BLOCK_SHIFT_CLOSE'");
    expect(shiftModal).toContain("api.shifts.closeWithOpenOrders");
    expect(shiftModal).toContain("can('shifts.close_with_open_orders')");
    expect(shiftModal).toContain('إغلاق الوردية مع إبقاء الطلبات المفتوحة');
    expect(shiftModal).not.toContain("show(isAr ? 'تم إغلاق الوردية واليوم بنجاح'");
  });

  it('deducts posted cash expenses and cash purchases from expected drawer cash without double-counting canonical expense operations', () => {
    expect(migration).toContain('posted_cash_expenses AS');
    expect(migration).toContain('cash_purchases AS');
    expect(migration).toContain("COALESCE(p.payment_method, 'cash') = 'cash'");
    expect(migration).toContain("e.status = 'posted'");
    expect(migration).toContain("op.operation_type = 'expense'");
    expect(migration).toContain('NOT EXISTS (');
    expect(migration).toContain('- COALESCE(e.amount, 0)');
    expect(migration).toContain('- COALESCE(p.amount, 0)');
    expect(shiftReport).toContain("isAr ? 'مشتريات كاش' : 'Cash Purchases'");
    expect(shiftReport).toContain('cashPurchaseDetails');
  });
});
