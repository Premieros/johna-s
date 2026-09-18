import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const migration = fs.readFileSync(
  'supabase/migrations/20260918225500_reassert_idempotent_kitchen_void_and_repair_overage.sql',
  'utf8',
);
const verifier = fs.readFileSync('scripts/db/verify-schema.js', 'utf8');

describe('sent-item void idempotency production guard', () => {
  it('reasserts current-quantity alignment instead of subtracting the void twice', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.sync_kitchen_sent_quantity_after_void');
    expect(migration).toContain('SET sent_quantity = GREATEST(COALESCE(v_current_quantity, 0), 0)');
    expect(migration).not.toContain('sent_quantity = GREATEST(sent_quantity - NEW.quantity');
  });

  it('repairs only provable live event overage with the authoritative inventory restore helper', () => {
    expect(migration).toContain("WHERE o.status IN ('open','held')");
    expect(migration).toContain('> oi.quantity + 0.000001');
    expect(migration).toContain('public._restore_kitchen_inventory_for_void');
    expect(migration).toContain('v_excess := v_row.pending_quantity - v_row.current_quantity');
  });

  it('makes schema verification fail if production drifts back to the legacy trigger', () => {
    expect(verifier).toContain("'sync_kitchen_sent_quantity_after_void'");
    expect(verifier).toContain('Kitchen void idempotency invariant');
    expect(verifier).toContain("def.includes('sent_quantity - new.quantity')");
    expect(verifier).toContain('|| !kitchenVoidInvariantOk');
  });
});
