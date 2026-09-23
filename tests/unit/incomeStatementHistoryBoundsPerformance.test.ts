import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const migration = fs.readFileSync(
  'supabase/migrations/20260923154500_income_statement_history_bounds.sql',
  'utf8',
);

describe('income statement history-bounds performance contract', () => {
  it('evaluates each history bound once per RPC call', () => {
    expect(migration).toContain('history_bounds AS MATERIALIZED');
    expect(migration).toContain('agg AS MATERIALIZED');
    expect((migration.match(/history_clamp_from/g) || []).length).toBe(1);
    expect((migration.match(/history_clamp_to/g) || []).length).toBe(1);
    expect(migration).toContain('j.entry_date >= hb.from_date');
    expect(migration).toContain('j.entry_date <= hb.to_date');
  });

  it('preserves the income-statement output contract', () => {
    for (const key of [
      "'revenue'",
      "'discount'",
      "'net_revenue'",
      "'cogs'",
      "'gross_profit'",
      "'expenses'",
      "'net_income'",
    ]) {
      expect(migration).toContain(key);
    }
  });

  it('preserves invoker security posture and grants', () => {
    expect(migration).not.toContain('SECURITY DEFINER');
    expect(migration).toContain('SET search_path = public, pg_temp');
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.get_income_statement(uuid,date,date)',
    );
    expect(migration).toContain('FROM PUBLIC, anon');
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.get_income_statement(uuid,date,date)',
    );
    expect(migration).toContain('TO authenticated, service_role');
  });
});
