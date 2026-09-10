import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('account balances, closing and inventory safety contracts', () => {
  it('derives shift sales from shift_operations and never sales.shift_id', () => {
    const source = read('src/features/trade/services/shiftClosingFinancials.ts');
    expect(source).toContain(".from('shift_operations')");
    expect(source).toContain("op.reference_type === 'sale'");
    expect(source).not.toContain(".eq('shift_id', shiftId);\n\n  const salesList");
    expect(source).toContain("customer:customers(employee_user_id)");
    expect(source).toContain("sale.customer?.employee_user_id ? 'employee_credit' : 'credit'");
  });

  it('keeps employee credit on the existing POS credit flow', () => {
    const paymentPanel = read('src/features/pos/components/checkout/PaymentPanel.tsx');
    const paymentService = read('src/features/pos/services/payment.ts');
    const posMath = read('src/lib/posMath.ts');
    expect(paymentPanel).not.toContain('employee_credit');
    expect(paymentService).not.toContain('process_employee_credit_sale');
    expect(posMath).toContain("'cash' | 'card' | 'transfer' | 'credit'");
    expect(posMath).not.toContain('employee_credit');
  });

  it('does not double-count supplier payments in the authoritative balance', () => {
    const migration = read('supabase/migrations/20260910211500_account_balances_closing_employee_credit.sql');
    expect(migration).toContain("COALESCE(sum(p.paid_amount), 0) AS total_paid");
    expect(migration).toContain('recorded_payments_total');
    expect(migration).toContain('invoice_time_paid');
    expect(migration).toContain("public.can_permission('suppliers.view')");
    expect(migration).toContain("public.can_permission('customers.manage')");
    expect(migration).toContain("public.can_permission('accounts.view')");
    expect(migration).toContain("public.can_permission('sales.payment.receive')");
    expect(migration).toContain('RETURN public.receive_payment(');
  });

  it('shows raw-material stock only for an explicitly selected branch', () => {
    const panel = read('src/features/inventory/components/RawMaterialBranchStockPanel.tsx');
    const inventoryPage = read('src/features/inventory/pages/InventoryPage.tsx');
    expect(inventoryPage).toContain('<RawMaterialBranchStockPanel />');
    expect(panel).toContain(".from('raw_material_inventory')");
    expect(panel).toContain(".eq('branch_id', selectedBranchId)");
    expect(panel).toContain('if (!selectedBranchId)');
    expect(panel).not.toContain('branches[0]');
    expect(panel).not.toMatch(/selectedBranchId\s*\|\|\s*branches/);
    expect(panel).toContain("row.branch_id === selectedBranchId");
  });
});
