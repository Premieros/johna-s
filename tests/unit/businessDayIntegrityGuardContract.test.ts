import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260929223000_business_day_integrity_guard.sql',
  'utf8',
);

describe('business-day integrity guard', () => {
  it('bounds live business-day initialization to the clock-reachable date', () => {
    expect(migration).toContain('private.current_fixed_business_date');
    expect(migration).toContain('v_candidate:=LEAST(v_candidate,v_max_date)');
    expect(migration).toContain('v_last_close.business_date < v_max_date');
  });

  it('blocks rollover before the configured fixed-time cutoff', () => {
    expect(migration).toContain('private.business_day_fixed_cutoff');
    expect(migration).toContain("'error','BUSINESS_DAY_NOT_FINISHED'");
    expect(migration).toContain('v_now < v_cutoff');
  });

  it('advances exactly one business date and never skips over a preclosed date', () => {
    expect(migration).toContain('v_next_date:=v_state.business_date+1');
    expect(migration).toContain("'error','NEXT_BUSINESS_DAY_ALREADY_CLOSED'");
    expect(migration).not.toContain(
      'v_next_date:=public._next_unclosed_business_date(p_branch_id,v_state.business_date+1)',
    );
  });

  it('keeps the active shift preserved and does not touch printing or kitchen flows', () => {
    expect(migration).toContain("'shift_preserved',true");
    expect(migration).not.toContain('cloud_print_jobs');
    expect(migration).not.toContain('send_to_kitchen');
    expect(migration).not.toContain('order_kitchen');
  });
});
