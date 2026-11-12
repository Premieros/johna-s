import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20261102113000_kds_display_latest_send_age.sql',
  'utf8',
);
const page = readFileSync('src/features/inventory/pages/KitchenDisplayPage.tsx', 'utf8');

describe('KDS one-hour display auto-close contract', () => {
  it('measures the card from the latest kitchen send for that station', () => {
    expect(migration).toContain('COALESCE(oks.sent_at, o.kitchen_sent_at, o.created_at) AS queue_at');
    expect(migration).toContain('MAX(ai.queue_at)');
    expect(migration).not.toContain('MIN(ai.queue_at)');
  });

  it('preserves only unsatisfied kitchen quantity after a served baseline', () => {
    expect(migration).toContain('(oks.sent_quantity - COALESCE(ksb.served_quantity, 0)) AS quantity');
    expect(migration).toContain('LEFT JOIN public.order_kitchen_served_quantities ksb');
    expect(migration).toContain('COALESCE(oks.sent_quantity, 0) > COALESCE(ksb.served_quantity, 0)');
  });

  it('does not alter the POS order, kitchen status, financial, or inventory state', () => {
    expect(migration).not.toContain('UPDATE public.orders');
    expect(migration).not.toContain('UPDATE public.sales');
    expect(migration).not.toContain('UPDATE public.inventory');
    expect(migration).not.toContain('DELETE FROM public.');
    expect(page).toContain('isKitchenQueueAutoClosed(item, now)');
    expect(page).toContain('POS order status and the sale were not changed.');
  });

  it('keeps cards in the overdue 40–60 minute window and auto-closes at 60 minutes', () => {
    expect(page).toContain('isKitchenQueueOverdue(item, now)');
    expect(page).toContain('autoClosedItems = items.filter');
    expect(page).toContain('Auto-closed in the kitchen display after one hour');
  });

  it('does not fetch order context for cards already auto-closed in this display', () => {
    expect(page).toContain('filter((item) => !isKitchenQueueAutoClosed(item, Date.now()))');
  });

  it('uses Realtime for normal KDS wake and a 60-second reconciliation fallback', () => {
    expect(page).toContain('subscribePosRealtime(');
    expect(page).toContain('}, 60000);');
    expect(page).not.toContain('}, 30000);');
  });
});
