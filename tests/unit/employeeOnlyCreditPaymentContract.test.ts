import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('employee-only credit payment contract', () => {
  it('keeps POS credit disabled unless the selected customer is an employee', () => {
    const panel = read('src/features/pos/components/checkout/PaymentPanel.tsx');
    const order = read('src/features/pos/hooks/usePosOrderBase.ts');

    expect(panel).toContain("selectedCustomer?.customer_type === 'employee'");
    expect(panel).toContain("m === 'credit' && !creditAllowed");
    expect(panel).toContain('الدفع الآجل ممنوع لغير الموظفين');
    expect(order).toContain("paymentMethod === 'credit'");
    expect(order).toContain("customer.customer_type === 'employee'");
    expect(order).toContain('الدفع الآجل مسموح للموظفين فقط');
  });

  it('enforces employee-only credit at the sales table boundary', () => {
    const migration = read('supabase/migrations/20260920132500_employee_only_credit_sales.sql');

    expect(migration).toContain("lower(COALESCE(NEW.payment_method, '')) = 'credit'");
    expect(migration).toContain("c.customer_type = 'employee'");
    expect(migration).toContain('c.branch_id = NEW.branch_id');
    expect(migration).toContain('CREDIT_EMPLOYEE_ONLY');
    expect(migration).toContain('BEFORE INSERT OR UPDATE OF payment_method, customer_id, branch_id');
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.enforce_employee_only_credit_sale()');
  });
});
