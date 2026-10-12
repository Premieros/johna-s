import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const indexAndSettle = readFileSync(
  'scripts/experiments/raw_fifo_receipt_settle_candidate_20261012.sql', 'utf8');
const balanceAndCount = readFileSync(
  'scripts/experiments/raw_stock_official_balance_delta_candidate_20261012.sql', 'utf8');

describe('Johnas #489 staged total database work reduction contracts', () => {
  it('does not create competing warehouse counters or automatic production migrations', () => {
    expect(indexAndSettle).toContain('Not a migration');
    expect(balanceAndCount).toContain('Not a migration');
    expect(indexAndSettle).toContain('idx_raw_batches_fifo_positive_order_review');
    expect(indexAndSettle).toMatch(/WHERE quantity>0/);
    expect(indexAndSettle).toContain('expiry_date ASC NULLS LAST,created_at ASC,id ASC');
    expect(balanceAndCount).toContain('public.raw_material_inventory');
    expect(balanceAndCount).not.toContain('raw_stock_warehouse_shadow');
    expect(balanceAndCount).not.toMatch(/CREATE\s+TABLE\s+/i);
    expect(balanceAndCount).not.toMatch(/CREATE\s+TRIGGER\s+/i);
  });

  it('terminates all three staged SQL functions rather than concatenating bare definitions', () => {
    expect(balanceAndCount.split('CREATE OR REPLACE FUNCTION public.')).toHaveLength(4);
    expect(balanceAndCount.split('$function$;')).toHaveLength(4);
    expect(balanceAndCount.trimEnd().endsWith(';')).toBe(true);
  });

  it('preserves per-source FIFO debt and accounting updates while writing receipt batch once', () => {
    expect(indexAndSettle).toContain('UPDATE public.raw_fifo_debts');
    expect(indexAndSettle).toContain('UPDATE public.raw_fifo_debt_price_estimates');
    expect(indexAndSettle).toContain('UPDATE public.inventory_ledger');
    expect(indexAndSettle).toContain('public._fifo_adjust_reference_delta(');
    expect(indexAndSettle).toContain('UPDATE public.raw_fifo_settlements');
    expect(indexAndSettle).toContain('SET quantity=LEAST(quantity+v_take,0)');
    expect(indexAndSettle).toContain('SET quantity=GREATEST(quantity-v_total_settled,0)');
    expect(indexAndSettle).not.toContain('SET quantity=GREATEST(quantity-v_take,0)');
    expect((indexAndSettle.match(/SET quantity=GREATEST\(quantity-v_total_settled,0\)/g) || []).length).toBe(1);
    expect(indexAndSettle).toContain('FOR UPDATE');
  });

  it('atomically updates the official signed branch balance, preserving strict-shortage and warehouse semantics', () => {
    expect(balanceAndCount).toContain('SET quantity=quantity+p_qty,updated_at=now()');
    expect(balanceAndCount).toContain('SET quantity=quantity-(v_total_removed+v_oversold),updated_at=now()');
    expect(balanceAndCount).toContain('IF v_total_removed+v_oversold>0 THEN');
    expect(balanceAndCount).toContain('PERFORM pg_advisory_xact_lock');
    expect(balanceAndCount).toContain('warehouse_id=p_warehouse_id');
    expect(balanceAndCount).toContain('SELECT COALESCE(SUM(quantity),0)');
    expect(balanceAndCount).toContain('v_item.raw_material_id::text||');
    // Preserve the branch/warehouse selectors and unchanged avg_cost BEFORE trigger.
    expect(balanceAndCount).not.toContain('CREATE OR REPLACE FUNCTION public._raw_inventory_actual_avg_cost_guard');
    expect(balanceAndCount).not.toContain('DROP TRIGGER');
    expect(balanceAndCount).not.toMatch(/DELETE\s+FROM\s+public\.raw_fifo_debts/i);
  });
});
