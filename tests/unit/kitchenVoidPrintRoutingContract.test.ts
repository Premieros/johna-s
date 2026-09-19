import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260919220500_kitchen_void_print_routing.sql',
  'utf8',
);

describe('kitchen void print routing contract', () => {
  it('routes approved kitchen voids through the product category station', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.enqueue_kitchen_void_print()');
    expect(migration).toContain('JOIN public.categories c');
    expect(migration).toContain('JOIN public.kitchen_stations ks');
    expect(migration).toContain("AND ks.branch_id = NEW.branch_id");
    expect(migration).toContain("AND ks.is_active = true");
    expect(migration).toContain("lower(btrim(ks.code)) <> 'cashier'");
  });

  it('creates an idempotent kitchen print job without replaying business mutations', () => {
    expect(migration).toContain("v_idempotency_key := 'kitchen-void:' || NEW.id::text || ':' || v_station_code");
    expect(migration).toContain('INSERT INTO public.cloud_print_jobs');
    expect(migration).toContain("'kitchen'");
    expect(migration).toContain("ON CONFLICT (branch_id, idempotency_key) DO NOTHING");
    expect(migration).toContain("'event', 'kitchen_void'");
  });

  it('does not block the cancellation if a route is missing', () => {
    expect(migration).toContain("'KITCHEN_VOID_PRINT_ROUTE_MISSING'");
    expect(migration).toContain('RETURN NEW;');
  });
});
