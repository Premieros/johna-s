import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('returned sales archive and day report contract', () => {
  it('archives fully returned invoices instead of hard deleting financial rows', () => {
    const sales = read('src/features/trade/pages/SalesPage.tsx');
    const trade = read('src/api/domains/trade.ts');

    expect(sales).toContain("filters: [{ column: 'is_archived', value: false }]");
    expect(sales).toContain("api.trade.archiveReturnedSale");
    expect(sales).toContain("r.status === 'returned'");
    expect(sales).toContain("(r.refunded_amount || 0) >= r.total");
    expect(sales).not.toContain("supabase.from('sale_items').delete()");
    expect(sales).not.toContain("supabase.from('sales').delete()");
    expect(trade).toContain("rpc('archive_returned_sale', p)");
  });

  it('defines net daily discount after refunds and keeps full-return discount at zero', () => {
    const migration = read('supabase/migrations/20260921001500_returned_sales_archive_and_net_daily_discount.sql');

    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.archive_returned_sale");
    expect(migration).toContain("FULL_REFUND_REQUIRED");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false");
    expect(migration).toContain("GREATEST(COALESCE(s.total,0)-COALESCE(s.refunded_amount,0),0)");
    expect(migration).not.toContain("'discount_amount',s.discount_amount,'tax_amount'");
  });
});
