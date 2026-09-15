import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260915084500_pos_unconditional_component_sellthrough.sql',
  'utf8',
);

describe('POS unconditional component sell-through contract', () => {
  it('removes stock availability as a sale authorization gate', () => {
    expect(migration).toContain('POS is sell-through: availability never blocks configured consumption');
    expect(migration).toContain('SALE_STOCK_GATE_STILL_PRESENT');
    expect(migration).toContain('v_base_ready := false');
  });

  it('does not invent finished-product stock requirements for unconfigured products', () => {
    expect(migration).toContain('No configured component source: sell without a stock gate');
    expect(migration).toContain('SALE_READY_FALLBACK_PATCH_MARKER_MISSING');
  });

  it('deducts inventory effects from reusable modifier groups linked to the sold product', () => {
    expect(migration).toContain('JOIN public.product_modifier_group_products gp');
    expect(migration).toContain('gp.product_id=v_product_id');
    expect(migration).toContain('gp.branch_id=p_branch_id');
    expect(migration).toContain('REUSABLE_MODIFIER_EFFECT_LINK_MISSING');
  });

  it('preserves the raw negative-consumption authority', () => {
    expect(migration).toContain('public._raw_remove_fifo');
    expect(migration).toContain('RAW_NEGATIVE_CONSUMPTION_CONTRACT_MISSING');
  });
});
