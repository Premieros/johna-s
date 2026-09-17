import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const settlement = readFileSync('supabase/migrations/20260917084500_sent_only_order_settlement.sql', 'utf8');

describe('POS kitchen and warehouse authority contract', () => {
  it('keeps settlement bound to the order warehouse', () => {
    expect(settlement).toContain('v_order.inventory_warehouse_id IS DISTINCT FROM p_warehouse_id');
    expect(settlement).toContain("'KITCHEN_WAREHOUSE_MISMATCH'");
  });

  it('settles only explicit unsettled kitchen event ids', () => {
    expect(settlement).toContain('event_ids uuid[] NOT NULL');
    expect(settlement).toContain('e.id = ANY(v_queue.event_ids)');
    expect(settlement).toContain('e.settled_sale_id IS NULL');
  });

  it('never performs a second physical inventory deduction during payment settlement', () => {
    const consume = settlement.split('CREATE OR REPLACE FUNCTION public._consume_kitchen_sale_settlement')[1]
      ?.split('CREATE OR REPLACE FUNCTION public._finalize_kitchen_sale_settlement')[0] || '';
    expect(consume).not.toContain('_deduct_sale_inventory_with_modifiers_core');
    expect(consume).not.toContain('deduct_sale_inventory_with_modifiers(');
    expect(consume).toContain('order_kitchen_inventory_effects');
  });
});
