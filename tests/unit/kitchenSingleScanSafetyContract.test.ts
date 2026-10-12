import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const filename = 'kitchen_fifo_single_scan_candidate_20261012.sql';
const sql = readFileSync('scripts/experiments/'+filename, 'utf8');
const statements = sql.replace(/--[^\n]*/g, '');

describe('unwired kitchen single-scan preparation safety', () => {
  it('cannot automatically replace production FIFO or triggers', () => {
    expect(readdirSync('supabase/migrations')).not.toContain(filename);
    expect(statements).toContain('FUNCTION public._raw_remove_fifo_single_scan_candidate(');
    expect(statements).not.toMatch(/FUNCTION\s+public\._raw_remove_fifo\s*\(/i);
    expect(statements).not.toMatch(/SECURITY\s+DEFINER|CREATE\s+TRIGGER|ALTER\s+TABLE/i);
    expect(statements).toContain('FROM PUBLIC, anon, authenticated, service_role');
  });

  it('keeps locking, FIFO ordering and branch/warehouse checks', () => {
    expect(statements).toContain('pg_advisory_xact_lock');
    expect(statements).toContain('WAREHOUSE_BRANCH_MISMATCH');
    expect(statements).toContain('ORDER BY expiry_date NULLS LAST,created_at,id');
    expect(statements).toContain('FOR UPDATE');
    expect(statements).toContain('INSERT INTO public.raw_fifo_debts');
  });
});
