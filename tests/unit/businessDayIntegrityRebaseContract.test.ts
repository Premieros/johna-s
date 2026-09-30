import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260930064000_business_day_integrity_rebase.sql',
  'utf8',
);

describe('business-day integrity rebase', () => {
  it('separates the clock business date from the cutoff-aware reachable state ceiling', () => {
    expect(migration).toContain('private.current_fixed_business_date');
    expect(migration).toContain('private.max_reachable_business_state_date');
    expect(migration).toContain('p_at>=v_cutoff');
    expect(migration).toContain('RETURN v_business_date+1');
  });

  it('bounds new/live state so historical future closes cannot drag it forward', () => {
    expect(migration).toContain('v_max_date:=private.max_reachable_business_state_date');
    expect(migration).toContain('v_candidate:=LEAST(v_candidate,v_max_date)');
    expect(migration).toContain('v_last_close.business_date < v_max_date');
  });

  it('blocks manual rollover before the configured cutoff and advances exactly one day', () => {
    expect(migration).toContain('private.business_day_fixed_cutoff');
    expect(migration).toContain("'error','BUSINESS_DAY_NOT_FINISHED'");
    expect(migration).toContain('v_next_date:=v_state.business_date+1');
    expect(migration).toContain("'error','NEXT_BUSINESS_DAY_ALREADY_CLOSED'");
  });

  it('guards no-open-shift day_close before finalizing a future/not-due date', () => {
    const guardAt = migration.indexOf("v_cutoff:=private.business_day_fixed_cutoff(p_branch_id,v_target_date)");
    const finalizeAt = migration.indexOf('v_result:=public._finalize_day_close');
    expect(guardAt).toBeGreaterThan(-1);
    expect(finalizeAt).toBeGreaterThan(guardAt);
    expect(migration.slice(guardAt, finalizeAt)).toContain("'BUSINESS_DAY_NOT_FINISHED'");
  });

  it('does not touch protected operational or emergency financial surfaces', () => {
    expect(migration).not.toContain('get_branch_treasury_day_close_reconciliation');
    expect(migration).not.toContain('cloud_print_jobs');
    expect(migration).not.toContain('send_to_kitchen');
    expect(migration).not.toContain('order_kitchen');
    expect(migration).not.toContain('process_sale');
    expect(migration).not.toContain('supplier');
  });
});
