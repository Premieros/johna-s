import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260923073000_snapshot_void_refund_reversal.sql',
  'utf8',
);

describe('Phase 4 kitchen snapshot reversal contract', () => {
  it('makes v2 void restore from the immutable kitchen snapshot', () => {
    expect(migration).toContain('public._restore_kitchen_snapshot_raws');
    expect(migration).toContain('COALESCE(v_event.snapshot_version,1)>=2');
    expect(migration).toContain('jsonb_array_length(v_event.component_snapshot)>0');
    expect(migration).toContain("'kitchen_void'");
  });

  it('makes all-v2 settled refunds restore from the same snapshot', () => {
    expect(migration).toContain('v_event_count=v_snapshot_event_count');
    expect(migration).toContain('abs(v_effective_sent_total-v_item_qty)<=0.000001');
    expect(migration).toContain("'snapshot_restored',true");
    expect(migration).toContain("'refund'");
  });

  it('keeps a compatibility path for historical and mixed transactions', () => {
    expect(migration).toContain('Legacy/mixed transactions retain the previously proven compatibility path.');
    expect(migration).toContain('public._restore_inventory_unit_consumption_source');
    expect(migration).toContain('public._restore_refund_hybrid_inventory(\n    p_sale_id,p_product_id');
  });

  it('keeps snapshot helpers internal and does not touch printing', () => {
    expect(migration).toContain('REVOKE ALL ON FUNCTION public._restore_kitchen_snapshot_raws');
    expect(migration).not.toContain('cloud_print_jobs');
    expect(migration).not.toContain('enqueue_cloud_kitchen_print');
    expect(migration).not.toContain('printer');
  });
});
