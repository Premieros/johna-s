import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const candidate = readFileSync(
  'scripts/experiments/kitchen_approved_price_bounded_candidate_20261011.sql', 'utf8',
);
const emergency = readFileSync(
  'supabase/migrations/20261011063452_pause_blocking_kitchen_price_snapshot_20261011.sql', 'utf8',
);

describe('P0 approved kitchen price optimization draft safety (#486)', () => {
  it('keeps unapproved SQL out of canonical migrations and leaves the emergency pause intact', () => {
    expect(existsSync('supabase/migrations/20261011113000_kitchen_approved_price_candidate.sql')).toBe(false);
    expect(candidate).toContain('SECURITY INVOKER');
    expect(candidate).toContain("SET search_path TO 'public', 'pg_temp'");
    expect(candidate).not.toMatch(/\b(ENABLE\s+TRIGGER|UPDATE\s+public\.order_kitchen_inventory_events|DROP\s+TRIGGER|DISABLE\s+TRIGGER)\b/i);
    expect(emergency).toContain('DISABLE TRIGGER trg_capture_kitchen_ingredient_prices');
  });

  it('preserves the purchase finance-permission predicate and receipt de-duplication', () => {
    expect(candidate).toContain('private.financial_row_visible(p.id,p.branch_id,p.created_at)');
    expect(candidate).toContain("(auth.uid() IS NULL AND current_user IN ('postgres','service_role'))");
    expect(candidate).toContain('public._normalize_raw_purchase_uom(');
    expect(candidate).toContain('AND NOT EXISTS (');
    expect(candidate).toContain("il.reference_type='purchase'");
    expect(candidate).toContain("p.status='completed'");
    expect(candidate).toContain("sc.status='applied'");
  });

  it('requires branch, as-of, approved sources and preserves canonical tie ordering', () => {
    expect(candidate).toContain('rm.branch_id=p_branch_id');
    expect(candidate).toContain('rm.id=ANY(p_raw_material_ids)');
    expect(candidate).toContain('il.created_at<=p_as_of');
    expect(candidate).toContain('pe.priced_at<=p_as_of');
    expect(candidate).toContain('e.priced_at DESC NULLS LAST,');
    expect(candidate).toContain('e.source_rank,');
    expect(candidate).toContain('e.reference_number DESC NULLS LAST,');
    expect(candidate).toContain('e.event_id DESC');
    expect(candidate).not.toMatch(/(?:i\.|rb\.|rm\.)avg_cost/i);
  });
});
