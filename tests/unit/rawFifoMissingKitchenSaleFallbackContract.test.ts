import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260922124500_raw_fifo_missing_kitchen_sale_fallback.sql',
  'utf8',
).replace(/\r\n/g, '\n');

describe('FIFO missing historical kitchen-event fallback contract', () => {
  it('keeps live orders and event-specific journals fail-closed', () => {
    expect(migration).toContain('FIFO_KITCHEN_EVENT_MISSING_WITH_LIVE_ORDER');
    expect(migration).toContain('v_order_count>0');
    expect(migration).toContain('v_journal_count>0');
    expect(migration).toContain('FIFO_KITCHEN_EVENT_MISSING_WITH_LIVE_REFERENCE');
  });

  it('allows only one completed sale with no live order as the historical fallback', () => {
    expect(migration).toContain("IF v_sale_count=1 AND v_sale_status='completed' THEN");
    expect(migration).toContain('public._fifo_adjust_sale_cogs_delta(v_sale_id,p_delta)');
    expect(migration).toContain("'historical_sale_fallback',true");
    expect(migration).toContain("'ledger_authoritative',true");
    expect(migration).toContain('FIFO_KITCHEN_EVENT_MISSING_WITH_AMBIGUOUS_SALE');
  });

  it('does not weaken public access or touch printing', () => {
    expect(migration).toContain('FROM PUBLIC,anon,authenticated');
    expect(migration).toContain('TO service_role,postgres');
    expect(migration).not.toContain('print_jobs');
    expect(migration).not.toContain('cloud_print');
    expect(migration).not.toContain('printer');
  });
});
