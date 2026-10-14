import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const path = 'scripts/experiments/kitchen_atomic_print_handoff_PROPOSAL_20261014.sql';
const candidate = readFileSync(path, 'utf8');

describe('staged kitchen atomic print handoff contract', () => {
  it('is an isolated proposal, never a canonical production migration', () => {
    expect(candidate).toContain('STAGED / REVIEW ONLY');
    expect(readdirSync('supabase/migrations').some((name) => name.includes('atomic_print_handoff'))).toBe(false);
    expect(candidate).not.toMatch(/ALTER TABLE public\.order_kitchen_inventory_events|DISABLE TRIGGER|UPDATE public\.orders SET/i);
  });

  it('only enqueues the committed send delta, with exactly the existing branch/idempotency boundary', () => {
    expect(candidate).toContain("v_result := public._send_to_kitchen_core_20260914(p_order_id,p_sent_by);");
    expect(candidate).toContain("PERFORM private._enqueue_kitchen_sent_delta(");
    expect(candidate).toContain("'kitchen:' || v_station || ':' || v_key");
    expect(candidate).toContain('ON CONFLICT (branch_id,idempotency_key) DO NOTHING;');
    expect(candidate).toContain("RAISE EXCEPTION 'KITCHEN_PRINT_ORDER_BRANCH_MISMATCH'");
    expect(candidate).toContain("RAISE EXCEPTION 'KITCHEN_PRINT_DELTA_IDENTITY_MISSING'");
  });

  it('does not add polling or any print-client/Windows execution changes', () => {
    expect(candidate).not.toMatch(/pg_cron|CREATE EXTENSION|HTTP POST|window\.|Electron|UPDATE public\.cloud_print_jobs/i);
    const client = readFileSync('src/features/pos/services/cloudPrint.ts', 'utf8');
    expect(client).toContain('const idempotencyKey = `kitchen:${station}:${keySeed}`;');
  });
});
