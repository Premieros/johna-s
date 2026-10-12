-- STAGING/LOCAL ONLY. Reproducer for #489; never run on a busy production database.
-- This script creates ONLY temporary objects and ROLLBACKs all its work.
-- Its synthetic timings demonstrate planner behavior, NOT production before/after latency.
-- Intended for a disposable Postgres 17 database with normal statistics.
--
-- Run once with a SQL client that shows EXPLAIN output. No project data is read.
-- Compare literal and prepared custom/generic plans, buffers and six parity cases.
-- No automatic migration runner executes files under scripts/experiments.

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '45s';

CREATE TEMP TABLE open_check_guard_bench (
  branch_id uuid NOT NULL,
  kind text NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'submitted',
  next_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
) ON COMMIT DROP;

-- Replicate today's legacy indexes on the SMALL temporary test relation.
CREATE UNIQUE INDEX bench_cloud_print_unique_key
  ON open_check_guard_bench (branch_id, idempotency_key);
CREATE INDEX bench_cloud_print_claim
  ON open_check_guard_bench (branch_id, status, next_attempt_at, created_at);

-- 12k jobs per branch, mixed kitchen and receipt types, mixed key prefixes.
-- All UUIDs and jobs here are artificial; no real branch/order/customer data.
INSERT INTO open_check_guard_bench (branch_id, kind, idempotency_key)
SELECT
  CASE WHEN n % 2 = 0
    THEN '11111111-1111-4111-8111-111111111111'::uuid
    ELSE '22222222-2222-4222-8222-222222222222'::uuid END,
  CASE WHEN n % 5 = 0 THEN 'kitchen' ELSE 'receipt' END,
  CASE WHEN n % 3 = 0
    THEN 'open-check:' || md5(n::text)::uuid::text || ':' || n::text
    WHEN n % 5 = 0 THEN 'kitchen:' || md5(n::text)
    ELSE 'receipt:auto:' || md5(n::text) END
FROM generate_series(1, 24000) AS seq(n);

-- Test an existing open check, another branch, wrong kind and missing receipt.
INSERT INTO open_check_guard_bench (branch_id, kind, idempotency_key) VALUES
  ('11111111-1111-4111-8111-111111111111', 'receipt', 'open-check:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:1'),
  ('22222222-2222-4222-8222-222222222222', 'receipt', 'open-check:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:2'),
  ('22222222-2222-4222-8222-222222222222', 'receipt', 'open-check:cccccccc-cccc-4ccc-8ccc-cccccccccccc:1'),
  ('11111111-1111-4111-8111-111111111111', 'kitchen', 'open-check:dddddddd-dddd-4ddd-8ddd-dddddddddddd:1');

ANALYZE open_check_guard_bench;

CREATE TEMP TABLE guard_case_results (
  stage text NOT NULL,
  scenario text NOT NULL,
  expected boolean NOT NULL,
  actual boolean NOT NULL
) ON COMMIT DROP;

-- Before: same kind/branch/LIKE predicate as the production RPC.
INSERT INTO guard_case_results (stage, scenario, expected, actual)
SELECT 'before', c.scenario, c.expected,
       EXISTS (
         SELECT 1
         FROM open_check_guard_bench cp
         WHERE cp.branch_id = c.branch_id
           AND cp.kind = 'receipt'
           AND cp.idempotency_key LIKE 'open-check:' || c.order_id::text || ':%'
       )
FROM (VALUES
  ('printed_branch_a', '11111111-1111-4111-8111-111111111111'::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, true),
  ('missing_branch_a', '11111111-1111-4111-8111-111111111111'::uuid, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid, false),
  ('other_branch_only', '11111111-1111-4111-8111-111111111111'::uuid, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid, false),
  ('wrong_kind_only', '11111111-1111-4111-8111-111111111111'::uuid, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid, false),
  ('printed_branch_b', '22222222-2222-4222-8222-222222222222'::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, true),
  ('other_branch_b', '22222222-2222-4222-8222-222222222222'::uuid, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid, true)
) AS c(scenario, branch_id, order_id, expected);

-- Baseline: absent key should walk branch-level keys; existing key may end sooner.
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT EXISTS (
  SELECT 1 FROM open_check_guard_bench cp
  WHERE cp.branch_id = '11111111-1111-4111-8111-111111111111'::uuid
    AND cp.kind = 'receipt'
    AND cp.idempotency_key LIKE 'open-check:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb:%'
);
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT EXISTS (
  SELECT 1 FROM open_check_guard_bench cp
  WHERE cp.branch_id = '11111111-1111-4111-8111-111111111111'::uuid
    AND cp.kind = 'receipt'
    AND cp.idempotency_key LIKE 'open-check:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:%'
);

-- Prepared-parameter parity: PL/pgSQL can cache custom or generic plans.
-- A constant literal LIKE plan alone is NOT sufficient to approve the index.
PREPARE bench_open_check_lookup (uuid, uuid) AS
SELECT EXISTS (
  SELECT 1 FROM open_check_guard_bench cp
  WHERE cp.branch_id = $1
    AND cp.kind = 'receipt'
    AND cp.idempotency_key LIKE 'open-check:' || $2::text || ':%'
);

-- Inspect both before-index plans. The generic plan may not infer a prefix
-- index bound when the LIKE prefix is supplied at execution time.
SET LOCAL plan_cache_mode = 'force_custom_plan';
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
EXECUTE bench_open_check_lookup(
  '11111111-1111-4111-8111-111111111111'::uuid,
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid
);
SET LOCAL plan_cache_mode = 'force_generic_plan';
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
EXECUTE bench_open_check_lookup(
  '11111111-1111-4111-8111-111111111111'::uuid,
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid
);

-- Experimental TEMP index: EXACTLY the proposed #489 prefix/partial definition.
-- It does not create any index in public.cloud_print_jobs.
CREATE INDEX bench_receipt_open_check_prefix
  ON open_check_guard_bench (branch_id, idempotency_key text_pattern_ops)
  WHERE kind = 'receipt';
ANALYZE open_check_guard_bench;

INSERT INTO guard_case_results (stage, scenario, expected, actual)
SELECT 'after', c.scenario, c.expected,
       EXISTS (
         SELECT 1
         FROM open_check_guard_bench cp
         WHERE cp.branch_id = c.branch_id
           AND cp.kind = 'receipt'
           AND cp.idempotency_key LIKE 'open-check:' || c.order_id::text || ':%'
       )
FROM (VALUES
  ('printed_branch_a', '11111111-1111-4111-8111-111111111111'::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, true),
  ('missing_branch_a', '11111111-1111-4111-8111-111111111111'::uuid, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid, false),
  ('other_branch_only', '11111111-1111-4111-8111-111111111111'::uuid, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid, false),
  ('wrong_kind_only', '11111111-1111-4111-8111-111111111111'::uuid, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid, false),
  ('printed_branch_b', '22222222-2222-4222-8222-222222222222'::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, true),
  ('other_branch_b', '22222222-2222-4222-8222-222222222222'::uuid, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid, true)
) AS c(scenario, branch_id, order_id, expected);

-- After: inspect for bench_receipt_open_check_prefix and a narrower range scan.
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT EXISTS (
  SELECT 1 FROM open_check_guard_bench cp
  WHERE cp.branch_id = '11111111-1111-4111-8111-111111111111'::uuid
    AND cp.kind = 'receipt'
    AND cp.idempotency_key LIKE 'open-check:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb:%'
);
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT EXISTS (
  SELECT 1 FROM open_check_guard_bench cp
  WHERE cp.branch_id = '11111111-1111-4111-8111-111111111111'::uuid
    AND cp.kind = 'receipt'
    AND cp.idempotency_key LIKE 'open-check:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:%'
);

-- Repeat both prepared-statement plans AFTER the temporary index.
-- If the generic plan still scans by branch, stop: the proposed index
-- alone may not fix the long-lived function's parameterized execution.
SET LOCAL plan_cache_mode = 'force_custom_plan';
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
EXECUTE bench_open_check_lookup(
  '11111111-1111-4111-8111-111111111111'::uuid,
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid
);
SET LOCAL plan_cache_mode = 'force_generic_plan';
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
EXECUTE bench_open_check_lookup(
  '11111111-1111-4111-8111-111111111111'::uuid,
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid
);
DEALLOCATE bench_open_check_lookup;

-- All six branch/type/print-once cases must remain the same on both sides.
SELECT scenario,
       bool_and(actual = expected) AS matches_expected,
       count(*) AS stages_verified
FROM guard_case_results
GROUP BY scenario
ORDER BY scenario;

DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1 FROM guard_case_results
    WHERE actual IS DISTINCT FROM expected
  ) OR (SELECT count(*) FROM guard_case_results) <> 12 THEN
    RAISE EXCEPTION 'OPEN_CHECK_GUARD_BENCH_PARITY_FAILED';
  END IF;
END;
$verify$;

-- Deliberate ROLLBACK. No persistent table/index, queue job or sales event.
ROLLBACK;
