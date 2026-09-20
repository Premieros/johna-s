import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('refund and daily discount integrity contract', () => {
  it('patches refund value using authoritative header totals and preserves zero-cash accounting reversals', () => {
    const migration = read('supabase/migrations/20260920234000_refund_discount_integrity.sql');
    expect(migration).toContain('v_refund_basis numeric(14,2)');
    expect(migration).toContain('v_item_ref_basis * GREATEST(COALESCE(v_sale.total, 0), 0)');
    expect(migration).toContain('IF v_refund_basis > 0 THEN');
    expect(migration).toContain('v_refund_basis / GREATEST(COALESCE(v_sale.subtotal, 0), 1)');
    expect(migration).toContain('refund_basis');
  });

  it('nets discounts in day and shift reports and blocks manual returned status', () => {
    const migration = read('supabase/migrations/20260920234000_refund_discount_integrity.sql');
    expect(migration).toContain('private.sale_report_remaining_ratio');
    expect(migration).toContain('_build_day_closing_report');
    expect(migration).toContain('get_shift_closing_report');
    expect(migration).toContain('RETURN_STATUS_REQUIRES_REFUND_WORKFLOW');
    expect(migration).toContain('trg_sales_returned_state_integrity');
  });

  it('does not touch the printing subsystem', () => {
    const migration = read('supabase/migrations/20260920234000_refund_discount_integrity.sql');
    expect(migration).not.toContain('sale_print_events');
    expect(migration).not.toContain('cloud_print_jobs');
    expect(migration).not.toContain('print_queue');
  });

  it('routes inconsistent returned invoices through refund repair instead of direct deletion', () => {
    const salesPage = read('src/features/trade/pages/SalesPage.tsx');
    expect(salesPage).toContain('hasRefundableQuantity');
    expect(salesPage).toContain('إصلاح المرتجع');
    expect(salesPage).toContain("r.status === 'pending'");
    expect(salesPage).not.toContain("user?.role");
    expect(salesPage).not.toContain("from('sale_items').delete()");
  });
});
