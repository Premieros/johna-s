import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260922203000_kitchen_raw_component_snapshot.sql',
  'utf8',
);

describe('Phase 3 kitchen raw component snapshot contract', () => {
  it('switches the internal kitchen core to direct raw deduction', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public._send_to_kitchen_core_20260914');
    expect(migration).toContain('public._deduct_kitchen_raw_components');
    expect(migration).not.toContain('public._ensure_inventory_unit_stock(');
    expect(migration).not.toContain('public._produce_inventory_unit_internal(');
    expect(migration).not.toContain('public._deduct_sale_inventory_with_modifiers_core(');
  });

  it('persists an exact raw composition snapshot per send event', () => {
    expect(migration).toContain('component_snapshot jsonb');
    expect(migration).toContain('snapshot_version smallint');
    expect(migration).toContain("'raw_material_id'");
    expect(migration).toContain("'quantity'");
    expect(migration).toContain('snapshot_version');
    expect(migration).toContain('2');
  });

  it('uses negative-capable FIFO directly with kitchen_send identity', () => {
    expect(migration).toContain('public._raw_remove_fifo(');
    expect(migration).toContain("'kitchen_send'");
    expect(migration).toContain('p_event_id');
    expect(migration).toContain('true');
  });

  it('flattens modifier inventory-unit effects instead of consuming unit stock', () => {
    expect(migration).toContain('resolve_inventory_unit_raw_components');
    expect(migration).toContain('resolve_kitchen_item_raw_components');
    expect(migration).toContain('product_modifier_inventory_effects');
    expect(migration).not.toContain('UPDATE public.inventory_unit_batches');
    expect(migration).not.toContain('INSERT INTO public.inventory_unit_entries');
  });
  it('materializes an unconfigured product as a same-name fallback raw instead of blocking send', () => {
    expect(migration).toContain('public._ensure_pos_fallback_product_raw');
    expect(migration).toContain('FALLBACK_RAW_CREATE_FAILED');
    expect(migration).toContain('round(p_quantity, 6)');
    expect(migration).not.toContain("'detail', 'NO_RAW_COMPONENTS'");
  });

});