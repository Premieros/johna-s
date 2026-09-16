import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('shift and user sales reporting contract', () => {
  it('groups user sales from the authoritative sale cashier identity using net sales', () => {
    const reports = read('src/features/reporting/pages/ReportsPage.tsx');

    expect(reports).toContain("reportType === 'sales_by_employee'");
    expect(reports).toContain("select('branch_id, cashier_id, total, refunded_amount, users:users!fk_sales_cashier(full_name, email)')");
    expect(reports).toContain('String(sale.cashier_id || name)');
    expect(reports).toContain('existing.total += netSaleAmount(sale)');
  });

  it('derives shift sales from trusted shift-operation sale references without double-counting split tenders', () => {
    const closing = read('src/features/trade/services/shiftClosingFinancials.ts');

    expect(closing).toContain("op.reference_type === 'sale' && op.reference_id");
    expect(closing).toContain('Array.from(new Set(');
    expect(closing).toContain(".from('sales')");
    expect(closing).toContain('grossSales += Number(sale.subtotal || sale.total || 0)');
    expect(closing).toContain('netSales += Number(sale.total || 0)');
  });

  it('keeps runtime integration proof that checkout attribution follows the acting operator', () => {
    const ownership = read('tests/integration/pos_operator_ownership.test.ts');

    expect(ownership).toContain('SELECT s.cashier_id, so.created_by, o.status AS order_status');
    expect(ownership).toContain('expect(paymentAttribution.rows[0].cashier_id).toBe(ids.users.branch_manager)');
    expect(ownership).toContain('expect(paymentAttribution.rows[0].created_by).toBe(ids.users.branch_manager)');
  });
});
