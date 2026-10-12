import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const benchmark = read('scripts/experiments/open_check_guard_isolated_benchmark_20261012.sql');
const candidate = read('scripts/experiments/kitchen_fifo_print_indexes_candidate_20261011.sql');
const original = read('supabase/migrations/20260928080000_work_authorization_expiry_and_reprint_guard.sql');

describe('open-check print guard isolated benchmark (#489)', () => {
  it('matches the deployed RPCs branch-scoped receipt prefix, without changing print-once policy', () => {
    const rpc = original.slice(original.indexOf('CREATE OR REPLACE FUNCTION public.get_open_order_print_state('));

    expect(rpc).toContain("cp.branch_id = v_order.branch_id");
    expect(rpc).toContain("cp.kind = 'receipt'");
    expect(rpc).toContain("cp.idempotency_key LIKE 'open-check:' || p_order_id::text || ':%'");
    expect(rpc).toContain("'OPEN_CHECK_ALREADY_PRINTED'");
    expect(rpc).toContain("public.can_permission('pos.reprint')");

    expect(candidate).toContain('CREATE INDEX IF NOT EXISTS idx_cloud_print_receipt_open_check_lookup');
    expect(candidate).toContain('ON public.cloud_print_jobs (branch_id, idempotency_key text_pattern_ops)');
    expect(candidate).toContain("WHERE kind = 'receipt'");
    expect(candidate).not.toContain('DROP INDEX');
    expect(candidate).not.toContain('CREATE OR REPLACE FUNCTION');
  });

  it('uses temporary synthetic data only and always ends in a rollback', () => {
    expect(benchmark).toMatch(/^BEGIN;/m);
    expect(benchmark).toContain("SET LOCAL lock_timeout = '2s'");
    expect(benchmark).toContain("SET LOCAL statement_timeout = '45s'");
    expect(benchmark).toContain('CREATE TEMP TABLE open_check_guard_bench');
    expect(benchmark).toContain('CREATE TEMP TABLE guard_case_results');
    expect(benchmark).toContain('ON COMMIT DROP;');
    expect(benchmark.trimEnd().endsWith('ROLLBACK;')).toBe(true);
    expect(benchmark).not.toContain('CREATE EXTENSION');
    expect(benchmark).not.toContain('CALL public.');
    expect(benchmark).not.toContain('SELECT public.enqueue_');

    const withoutComments = benchmark.split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    expect(withoutComments).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM|ALTER TABLE|CREATE INDEX)\s+public\./i);
    expect(withoutComments).not.toMatch(/\bCOMMIT\s*;/i);
    expect(withoutComments).not.toMatch(/\bTRUNCATE\s+/i);
  });

  it('compares exact-prefix plans both before and after the proposed index', () => {
    expect(benchmark.match(/EXPLAIN \(ANALYZE, BUFFERS, FORMAT JSON\)/g)).toHaveLength(8);
    expect(benchmark).toContain('CREATE INDEX bench_receipt_open_check_prefix');
    expect(benchmark).toContain('ON open_check_guard_bench (branch_id, idempotency_key text_pattern_ops)');
    expect(benchmark).toContain("WHERE kind = 'receipt'");
    expect(benchmark).toContain("cp.idempotency_key LIKE 'open-check:' || c.order_id::text || ':%'");
    expect(benchmark).toContain('PREPARE bench_open_check_lookup (uuid, uuid) AS');
    expect(benchmark.match(/EXECUTE bench_open_check_lookup\(/g)).toHaveLength(4);
    expect(benchmark.match(/SET LOCAL plan_cache_mode = 'force_custom_plan'/g)).toHaveLength(2);
    expect(benchmark.match(/SET LOCAL plan_cache_mode = 'force_generic_plan'/g)).toHaveLength(2);
    expect(benchmark).toContain('DEALLOCATE bench_open_check_lookup;');
    expect(benchmark).toContain('OPEN_CHECK_GUARD_BENCH_PARITY_FAILED');
  });

  it('checks missing/printed, branch isolation and kitchen receipt-type mismatch in both stages', () => {
    for (const scenario of [
      'printed_branch_a',
      'missing_branch_a',
      'other_branch_only',
      'wrong_kind_only',
      'printed_branch_b',
      'other_branch_b',
    ]) {
      expect(benchmark.split(`('${scenario}'`).length - 1).toBe(2);
    }
    expect(benchmark).toContain("(SELECT count(*) FROM guard_case_results) <> 12");
    expect(benchmark).toContain('bool_and(actual = expected)');
    expect(benchmark).toContain("CASE WHEN n % 5 = 0 THEN 'kitchen' ELSE 'receipt' END");
  });
});
