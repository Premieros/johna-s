import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260915084500_pos_unconditional_component_sellthrough.sql',
  'utf8',
);

describe('POS unconditional component sell-through contract', () => {
  it('removes stock availability as a sale authorization gate', () => {
    expect(migration).toContain('stock availability is informational and never blocks the sale path');
    expect(migration).toContain('SALE_STOCK_GATE_STILL_PRESENT');
    expect(migration).not.toContain('public.check_product_availability(');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public._deduct_sale_inventory_with_modifiers_core');
  });

  it('materializes an unconfigured sold product as a raw-material output', () => {
    expect(migration).toContain('public._ensure_pos_fallback_product_raw');
    expect(migration).toContain("'AUTO-PROD-' || replace(p_product_id::text,'-','')");
    expect(migration).toContain("'AUTO_POS_FALLBACK'");
    expect(migration).toContain('UNCONFIGURED_PRODUCT_OUTPUT_FALLBACK_MISSING');
  });

  it('materializes a priced modifier without a positive inventory effect as a raw-material output', () => {
    expect(migration).toContain('public._ensure_pos_fallback_modifier_raw');
    expect(migration).toContain("'AUTO-MOD-' || replace(p_option_id::text,'-','')");
    expect(migration).toContain('o.price_delta>0');
    expect(migration).toContain('e.quantity_delta>0');
    expect(migration).toContain('PRICED_MODIFIER_OUTPUT_FALLBACK_MISSING');
  });

  it('deducts inventory effects from reusable modifier groups linked to the sold product', () => {
    expect(migration).toContain('JOIN public.product_modifier_group_products gp');
    expect(migration).toContain('gp.product_id=v_product_id');
    expect(migration).toContain('gp.branch_id=p_branch_id');
    expect(migration).toContain('REUSABLE_MODIFIER_EFFECT_LINK_MISSING');
  });

  it('preserves the raw negative-consumption authority', () => {
    expect(migration).toContain('public._raw_remove_fifo');
    expect(migration).toContain('p_warehouse_id,v_link.required_qty');
    expect(migration).toContain('auth.uid(),true');
    expect(migration).toContain('RAW_NEGATIVE_CONSUMPTION_CONTRACT_MISSING');
  });
});
