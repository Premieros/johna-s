import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260921011000_auto_sale_production_source_reversal.sql',
  'utf8',
);

describe('auto-sale production reversal contract', () => {
  it('tracks exact source ownership for direct sales and kitchen-settled sale items', () => {
    expect(migration).toContain('source_order_item_id');
    expect(migration).toContain('source_sale_item_id');
    expect(migration).toContain('v_queue.order_item_id');
  });

  it('reverses AUTO_SALE_PRODUCTION recursively instead of returning phantom unit stock', () => {
    expect(migration).toContain('public._reverse_auto_sale_production');
    expect(migration).toContain("p.notes='AUTO_SALE_PRODUCTION'");
    expect(migration).toContain('production_consumption');
    expect(migration).toContain('public._raw_add');
  });

  it('keeps partial reversal idempotent', () => {
    expect(migration).toContain('inventory_unit_entry_reversals');
    expect(migration).toContain('auto_sale_production_reversals');
    expect(migration).toContain('reversed_quantity');
    expect(migration).toContain('pg_advisory_xact_lock');
  });

  it('keeps legacy records backward compatible while new tracked records use exact reversal', () => {
    expect(migration).toContain('Legacy event without batch-source history');
    expect(migration).toContain('Pre-migration sale: preserve prior behavior');
    expect(migration).toContain('REFUND_UNIT_SOURCE_RESTORE_INCOMPLETE');
  });
});
