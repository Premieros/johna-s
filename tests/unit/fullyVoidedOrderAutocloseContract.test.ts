import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260921113000_fully_voided_order_autoclose.sql',
  'utf8',
);

describe('fully voided table order auto-close contract', () => {
  it('auto-closes only a zero-item unpaid order inside the signed sent-item Void context', () => {
    expect(migration).toContain("FULLY_VOIDED_ORDER_AUTO_CLOSED");
    expect(migration).toContain("COALESCE(v_order.payment_status,'unpaid')='unpaid'");
    expect(migration).toContain('v_order.payment_at IS NULL');
    expect(migration).toContain("status='cancelled'");
    expect(migration).toContain("kitchen_status='cancelled'");
    expect(migration).toContain('_sent_item_void_context_matches(OLD.id,NULL)');
  });

  it('preserves partial Void by keeping the ordinary order totals update in the else branch', () => {
    expect(migration).toContain('ELSE');
    expect(migration).toContain('subtotal=v_subtotal');
    expect(migration).toContain('total=v_total');
  });

  it('does not touch printing, printer routes, or print-agent contracts', () => {
    expect(migration).not.toContain('cloud_print_jobs');
    expect(migration).not.toContain('printer_settings');
    expect(migration).not.toContain('claim_cloud_print_jobs');
    expect(migration).not.toContain('start_cloud_print_job');
    expect(migration).not.toContain('complete_cloud_print_job');
    expect(migration).not.toContain('station_code');
  });
});
