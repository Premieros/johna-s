import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260911160000_negative_raw_material_inventory.sql',
  'utf8',
).replace(/\r\n/g, '\n');

const warehouseBridge = readFileSync(
  'supabase/migrations/20260911151500_raw_material_warehouse_legacy_bridge.sql',
  'utf8',
).replace(/\r\n/g, '\n');

describe('negative raw material inventory migration contract', () => {
  it('relaxes only the raw-material quantity CHECK constraints', () => {
    expect(migration).toContain('DROP CONSTRAINT IF EXISTS raw_material_inventory_quantity_check');
    expect(migration).toContain('DROP CONSTRAINT IF EXISTS raw_material_batches_quantity_check');
  });

  it('keeps the canonical FIFO remover strict by default and posts oversold debt when allowed', () => {
    expect(migration).toContain('p_allow_negative boolean DEFAULT false');
    expect(migration).toContain("'OV-'||substr(replace(gen_random_uuid()::text,'-',''),1,12)");
    expect(migration).toContain("-v_remaining,0,NULL,NULL,COALESCE(NULLIF(p_reference_type,''),p_entry_type)||'_oversold'");
    expect(migration).toContain("'oversold',v_oversold");
    expect(migration).toContain(`REVOKE ALL ON FUNCTION public._raw_remove_fifo(uuid,uuid,uuid,numeric,text,text,uuid,text,uuid,boolean)`);
  });

  it('nets the branch aggregate with plain SUM and never clamps the balance to zero', () => {
    expect(migration).toContain('COALESCE(SUM(quantity),0),COALESCE(SUM(quantity*COALESCE(unit_cost,0)),0) INTO v_branch_qty,v_branch_value');
    expect(migration).not.toMatch(/GREATEST\(v_branch_qty/);
  });

  it('lets the sale deduction core run raw stock negative but keeps unit and finished gates strict', () => {
    expect(migration).toContain("AND COALESCE(v_res->>'error', '') <> 'INSUFFICIENT_RAW_MATERIAL_STOCK' THEN");
    expect(migration).toContain("'sale', 'sale', p_reference_id, p_reference_number, auth.uid(),\n      true");
    expect(migration).toContain("RAISE EXCEPTION 'INSUFFICIENT_UNIT_STOCK");
    expect(migration).toContain("RAISE EXCEPTION 'INSUFFICIENT_PRODUCT_STOCK product=");
    expect(migration).toContain('raw_oversold');
    expect(migration).not.toContain('INSUFFICIENT_RAW_MATERIAL_STOCK raw_material=');
    expect(migration).not.toContain('RAW_STOCK_CHANGED_DURING_SALE');
  });

  it('keeps modifier inventory effects server-authoritative', () => {
    expect(migration).toContain('public.resolve_product_modifiers');
    expect(migration).toContain('public.product_modifier_inventory_effects');
    expect(migration).toContain('INVALID_MODIFIER_INVENTORY_EFFECT');
  });

  it('restores kitchen voids through the canonical warehouse-aware raw add', () => {
    expect(migration).toContain('v_event.branch_id,v_event.warehouse_id,v_restore,v_cost,v_batch,CURRENT_DATE,NULL');
    expect(migration).toContain("'kitchen_void','kitchen_send',v_event.id,p_order_id::text,auth.uid()");
    expect(migration).not.toContain('v_effect.target_id,v_event.branch_id,v_restore');
  });

  it('exposes a raw-shortage-only signal that excludes manufactured-unit products', () => {
    expect(migration).toContain('raw_shortage_only boolean');
    expect(migration).toContain('v_has_manufactured_unit');
    expect(migration).toContain("COALESCE(v_error, '') = 'INSUFFICIENT_RAW_MATERIAL_STOCK'");
    expect(migration).toContain('NOT v_has_manufactured_unit');
  });

  it('keeps the three authoritative stock shortage codes in the availability contract', () => {
    expect(migration).toContain("'INSUFFICIENT_PRODUCT_STOCK',");
    expect(migration).toContain("'INSUFFICIENT_UNIT_STOCK',");
    expect(migration).toContain("'INSUFFICIENT_RAW_MATERIAL_STOCK'");
  });

  it('keeps the legacy raw deduction wrapper internal-only', () => {
    expect(warehouseBridge).toContain(
      'REVOKE ALL ON FUNCTION public.deduct_raw_material_inventory(uuid,numeric,uuid,uuid) FROM PUBLIC, anon, authenticated;',
    );
    expect(warehouseBridge).toContain(
      'GRANT EXECUTE ON FUNCTION public.deduct_raw_material_inventory(uuid,numeric,uuid,uuid) TO service_role, postgres;',
    );
    expect(warehouseBridge).not.toContain(
      'GRANT EXECUTE ON FUNCTION public.deduct_raw_material_inventory(uuid,numeric,uuid,uuid) TO authenticated',
    );
  });
});
