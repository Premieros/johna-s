import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('emergency kitchen price snapshot trigger isolation', () => {
  const migration = readFileSync('supabase/migrations/20261011063452_pause_blocking_kitchen_price_snapshot_20261011.sql', 'utf8');
  const kitchen = readFileSync('src/features/pos/services/kitchen.ts', 'utf8');
  const dispatch = readFileSync('src/features/pos/services/kitchenDispatch.ts', 'utf8');
  const original = readFileSync('supabase/migrations/20261009143000_kitchen_sale_known_price_snapshot.sql', 'utf8');

  it('pauses exactly the blocking price-snapshot trigger without dropping data or core inventory triggers', () => {
    expect(migration).toMatch(/ALTER TABLE public\.order_kitchen_inventory_events\s+DISABLE TRIGGER trg_capture_kitchen_ingredient_prices\s*;/);
    expect(migration).toContain("t.tgfoid = 'public._capture_kitchen_ingredient_prices()'::regprocedure");
    expect(migration).toContain("SET LOCAL lock_timeout = '2s'");
    expect(migration).not.toMatch(/DISABLE TRIGGER ALL|DROP TRIGGER|DROP FUNCTION|TRUNCATE |DELETE FROM |UPDATE public\./i);
    expect(original).toContain('CREATE TRIGGER trg_capture_kitchen_ingredient_prices');
  });

  it('leaves the authoritative send, per-station dispatch and cloud print path intact', () => {
    expect(kitchen).toContain("'send_to_kitchen'");
    expect(kitchen).toContain('dispatchKitchenStations(');
    expect(dispatch).toContain('enqueueCloudKitchenPrintJobs(');
  });
});
