import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260927095000_auto_business_day_close.sql',
  'utf8',
);

describe('automatic business-day close contract', () => {
  it('installs a private fixed-time worker and a minute scheduler', () => {
    expect(migration).toContain('private.run_due_business_day_closes()');
    expect(migration).toContain("COALESCE(bs.business_day_mode,'fixed_time')='fixed_time'");
    expect(migration).toContain("'auto-business-day-close'");
    expect(migration).toContain("'* * * * *'");
    expect(migration).toContain('CREATE EXTENSION IF NOT EXISTS pg_cron');
  });

  it('uses the configured Cairo cutoff and preserves system attribution', () => {
    expect(migration).toContain("AT TIME ZONE 'Africa/Cairo'");
    expect(migration).toContain('CASE WHEN v_end<=v_start THEN 1 ELSE 0 END');
    expect(migration).toContain('closed_by');
    expect(migration).toContain('NULL,');
  });

  it('advances the active business-day state at the exact cutoff before snapshot build', () => {
    const advance = migration.indexOf('UPDATE public.business_day_state');
    const report = migration.indexOf('public._build_day_closing_report');
    expect(advance).toBeGreaterThan(-1);
    expect(report).toBeGreaterThan(advance);
    expect(migration).toContain('started_at=v_cutoff');
  });

  it('is idempotent and not callable by normal app users', () => {
    expect(migration).toContain('ON CONFLICT DO NOTHING');
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION private.run_due_business_day_closes() FROM PUBLIC,anon,authenticated',
    );
  });
});
