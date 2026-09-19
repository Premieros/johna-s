import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260919180000_raw_pricing_authoritative_cost_cycle.sql',
  'utf8',
);
const pricing = readFileSync('src/features/catalog/pages/PricingPage.tsx', 'utf8');
const costing = readFileSync('src/features/costing/pages/CostingCenterPage.tsx', 'utf8');
const api = readFileSync('src/api/domains/costing.ts', 'utf8');

describe('raw pricing authoritative costing contract', () => {
  it('records manual pricing as a first-class costing event', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.raw_material_price_events');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.set_raw_material_price');
    expect(migration).toContain("'pricing'::text");
    expect(migration).toContain('public._raw_cost_events_for_costing');
  });

  it('orders purchase, stock count, and pricing by event time', () => {
    expect(migration).toContain('e.priced_at DESC NULLS LAST');
    expect(migration).toContain("'purchase'::text AS source");
    expect(migration).toContain("'stock_count'::text");
    expect(migration).toContain("'pricing'::text");
  });

  it('does not mutate inventory valuation from manual pricing', () => {
    expect(migration).not.toContain('UPDATE public.raw_material_inventory');
    expect(migration).not.toContain('UPDATE public.raw_material_batches');
    expect(migration).toContain('SET default_cost = round(p_unit_cost, 6)');
  });

  it('routes the pricing page through the guarded costing RPC', () => {
    expect(api).toContain("rpc('set_raw_material_price', p)");
    expect(pricing).toContain('costing.setRawMaterialPrice({');
    expect(pricing).not.toContain(".from('raw_materials')\n      .update({ default_cost: nextCost })");
  });

  it('shows manual pricing as a source in Costing Center history', () => {
    expect(costing).toContain("source === 'pricing'");
    expect(costing).toContain("isAr ? 'تسعير' : 'Pricing'");
  });
});
