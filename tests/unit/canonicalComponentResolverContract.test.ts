import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260922190000_canonical_component_resolver.sql',
  'utf8',
);

describe('canonical component resolver contract', () => {
  it('defines one non-mutating resolver for direct raws and reusable component groups', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.resolve_product_raw_components');
    expect(migration).toContain('WITH RECURSIVE');
    expect(migration).toContain('public.product_unit_links');
    expect(migration).toContain('public.inventory_unit_recipes');
    expect(migration).toContain('public.inventory_unit_recipe_units');
    expect(migration).toContain('public.recipe_items');
    expect(migration).toContain('COMPONENT_GROUP_CYCLE');
    expect(migration).toContain('COMPONENT_GROUP_NOT_IN_BRANCH');
    expect(migration).toContain('RAW_MATERIAL_NOT_IN_BRANCH');
  });

  it('does not manufacture, touch stock, or create production records', () => {
    expect(migration).not.toContain('_ensure_inventory_unit_stock(');
    expect(migration).not.toContain('_produce_inventory_unit_internal(');
    expect(migration).not.toContain('produce_inventory_unit(');
    expect(migration).not.toContain('INSERT INTO public.inventory_unit_productions');
    expect(migration).not.toContain('UPDATE public.inventory_unit_batches');
    expect(migration).not.toContain('_raw_remove_fifo(');
  });

  it('keeps the resolver internal rather than widening the browser API surface', () => {
    expect(migration).toContain('SECURITY INVOKER');
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.resolve_product_raw_components');
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('TO service_role, postgres');
  });
});
