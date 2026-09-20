import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('returned sales archive and closing-report contract', () => {
  it('archives fully returned invoices instead of hard deleting financial rows', () => {
    const sales = read('src/features/trade/pages/SalesPage.tsx');
    const trade = read('src/api/domains/trade.ts');

    expect(sales).toContain("filters: [{ column: 'is_archived', value: false }]");
    expect(sales).toContain("api.trade.archiveReturnedSale");
    expect(sales).toContain("canArchiveReturnedSale = can('refunds.approve')");
    expect(sales).toContain("r.status === 'returned'");
    expect(sales).not.toContain("can('sales.manage')");
    expect(sales).not.toContain("supabase.from('sale_items').delete()");
    expect(sales).not.toContain("supabase.from('sales').delete()");
    expect(trade).toContain("rpc('archive_returned_sale', p)");
  });

  it('requires actual refunded quantities before a returned sale can be archived', () => {
    const migration = read('supabase/migrations/20260921001500_returned_sales_archive_and_net_daily_discount.sql');

    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.archive_returned_sale");
    expect(migration).toContain("FULL_REFUND_REQUIRED");
    expect(migration).toContain("COALESCE(si.refunded_quantity,0) < COALESCE(si.quantity,0)");
    expect(migration).toContain("public.can_permission('refunds.approve')");
    expect(migration).not.toContain("public.can_permission('sales.manage')");
  });

  it('excludes archived full returns from day and shift totals without hiding legitimate discounts', () => {
    const migration = read('supabase/migrations/20260921001500_returned_sales_archive_and_net_daily_discount.sql');

    expect(migration).toContain("ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false");
    expect((migration.match(/COALESCE\(s\.is_archived,false\)=false/g) || []).length).toBeGreaterThanOrEqual(4);
    expect(migration).toContain("'discount_amount',s.discount_amount");
    expect(migration).not.toContain("GREATEST(COALESCE(s.total,0)-COALESCE(s.refunded_amount,0),0) / s.total");
  });
});
