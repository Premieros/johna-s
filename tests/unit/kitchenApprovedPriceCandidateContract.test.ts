import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const candidate = readFileSync(
  'scripts/experiments/kitchen_approved_price_bounded_candidate_20261011.sql', 'utf8',
);
const emergency = readFileSync(
  'supabase/migrations/20261011063452_pause_blocking_kitchen_price_snapshot_20261011.sql', 'utf8',
);


const stageA = readFileSync(
  'scripts/experiments/kitchen_approved_price_stage_a_sql_PROPOSAL_20261011.sql', 'utf8',
);
const stageB = readFileSync(
  'scripts/experiments/kitchen_approved_price_stage_b_enable_ONLY_IF_APPROVED_20261011.sql', 'utf8',
);
const emergencyDisable = readFileSync(
  'scripts/experiments/kitchen_approved_price_emergency_disable_PROPOSAL_20261011.sql', 'utf8',
);

describe('P0 approved kitchen price optimization draft safety (#486)', () => {
  it('separates installing inactive capture code from separately approved trigger activation', () => {
    expect(stageA).toContain('_kitchen_approved_price_candidate(');
    expect(stageA).toContain('KITCHEN_CAPTURE_TRIGGER_MUST_REMAIN_DISABLED');
    expect(stageA).toContain('KITCHEN_SOURCE_SYNC_EXPECTED_ENABLED');
    expect(stageA).not.toMatch(/ALTER TABLE public\.order_kitchen_inventory_events\s+ENABLE TRIGGER/i);
    expect(stageB).toMatch(/ALTER TABLE public\.order_kitchen_inventory_events\s+ENABLE TRIGGER trg_capture_kitchen_ingredient_prices/);
    expect(stageB).toContain('OPTIMIZED_CAPTURE_FUNCTION_NOT_INSTALLED');
    expect(emergencyDisable).toMatch(/ALTER TABLE public\.order_kitchen_inventory_events\s+DISABLE TRIGGER trg_capture_kitchen_ingredient_prices/);
    expect(stageA).not.toMatch(/\bTRUNCATE\s+|\bDELETE FROM public\.|\bUPDATE public\.order_kitchen_inventory_events/i);
    expect(stageB).not.toMatch(/\bTRUNCATE\s+|\bDELETE FROM public\.|\bUPDATE public\.order_kitchen_inventory_events/i);
    expect(existsSync('supabase/migrations/20261011120000_kitchen_price_capture_resume.sql')).toBe(false);
  });

  it('keeps unapproved SQL out of canonical migrations and leaves the emergency pause intact', () => {
    expect(existsSync('supabase/migrations/20261011113000_kitchen_approved_price_candidate.sql')).toBe(false);
    expect(candidate).toContain('SECURITY INVOKER');
    expect(candidate).toContain("SET search_path TO 'public', 'pg_temp'");
    expect(candidate).not.toMatch(/\b(ENABLE\s+TRIGGER|UPDATE\s+public\.order_kitchen_inventory_events|DROP\s+TRIGGER|DISABLE\s+TRIGGER)\b/i);
    expect(emergency).toContain('DISABLE TRIGGER trg_capture_kitchen_ingredient_prices');
  });

  it('does not expose a new public EXECUTE bypass to the approved price reader', () => {
    expect(candidate).toContain('REVOKE ALL ON FUNCTION public._kitchen_approved_price_candidate');
    expect(candidate).toContain('FROM PUBLIC, anon');
    expect(candidate).toContain('TO authenticated, service_role');
    expect(candidate).toContain('SECURITY INVOKER');
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
