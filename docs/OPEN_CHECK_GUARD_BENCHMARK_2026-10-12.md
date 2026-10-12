# Open-check print guard investigation — 2026-10-12

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Baseline: `main@6673da6db4dbd9db1e018131a3d7f15db978c022`
Branch: `perf/open-check-guard-benchmark-20261012`
Current PR: #492
Last updated: 2026-10-12

## Work status

State: **BLOCKED** — isolated benchmark and contract tests are prepared; an
exact-head Full Verify and disposable local/staging PostgreSQL run remain
necessary before recommending any real index. This is **not a deployed fix**.

## Guardrails

- No production SQL, DDL, index, trigger, price, warehouse or POS state changes.
- No real restaurant orders, physical printer tests or synthetic cloud jobs.
- No billable staging branch without separate owner approval.
- Preserve the unique (branch_id,idempotency_key) queue constraint, reprint
  approvals, FIFO locks, negative debt history and financial cost semantics.
- Draft PR only. Do not merge/deploy just because CI eventually passes.

## Baseline

The current `get_open_order_print_state` RPC checks branch ID, receipt kind,
and an `open-check:<order-id>:%` idempotency-key prefix. Read-only production
EXPLAIN chose the existing claim index by **branch ID alone** and filtered
around 6,100 unrelated rows.

| Individual sample | Runtime | Rows filtered | Shared buffer hits |
| --- | ---: | ---: | ---: |
| Absent open-check | 20.216 ms | 6,175 | 5,579 |
| Existing open-check | 7.081 ms | 6,171 | 5,576 |

These are single warm-cache measurements, not representative p50/p95.
The Oct 11 SQLSTATE 57014 incident affected many endpoints; the index is
not established as the root fix for all timeouts.

## Root-cause ledger

- Prefix LIKE on the unique standard btree lacks a suitable prefix range
  condition in the current plan; the planner scans branch entries.
- A partial `(branch_id, idempotency_key text_pattern_ops) WHERE kind='receipt'`
  index is a candidate, not yet independently benchmarked on realistic data.
  The SQL predicate is parameterized in PL/pgSQL, so a generic cached
  execution plan might not derive a LIKE-prefix index range even if a
  literal/custom plan does. This must be tested before endorsing DDL.
- Historical FIFO cost lookups separately use `idx_inventory_ledger_raw`
  by raw material only, then filter warehouse/branch and sort.
  Read-only samples on Oct 12: a priced material scanned 2,868 index rows
  and returned 2,152 candidate rows (~9.9 ms execution); an unpriced material
  filtered 2,277 rows (~5.0 ms). These are isolated leaf-query samples, not
  measured end-to-end kitchen-send delay or authorization to create FIFO indexes.
- HypoPG is not installed and the Supabase project has no usable independent
  staging development branch. No production index experiment has been run.

## Change ledger

- Added `scripts/experiments/open_check_guard_isolated_benchmark_20261012.sql`:
  temporary synthetic queue (24,000 jobs), legacy-index baseline, experimental
  temporary receipt-prefix index, eight EXPLAIN plans (including prepared
  custom and generic plan-cache modes) and six branch/type cases
  checked in both phases; explicit BEGIN/ROLLBACK.
- Added `tests/unit/openCheckPrintGuardBenchmarkContract.test.ts`: static safety,
  existing RPC policy, candidate-index and branch semantics contract.
- Updated this log and mandatory active-branch pointer.
- Original real index candidates stay under `scripts/experiments/`, **outside**
  canonical `supabase/migrations`. No application code changed.

## Verification ledger

- Production observations used read-only EXPLAIN and catalogue/statistics queries.
- Verified that the first CI failure for PR #492 was the *mandatory active
  worklog branch mismatch*, not a failing performance benchmark. This log and
  `docs/CURRENT_WORK_PLAN.md` are being synchronized on the draft branch.
- Source checks confirmed eight EXPLAIN sites (literal/custom/generic),
  six scenarios in both phases,
  temporary objects and final rollback. **SQL benchmark has not executed yet.**
- A green exact-head CI result is required before calling code verification done.

## Production gate

- Run the synthetic script on disposable local/staging PostgreSQL and capture
  index names, buffers, custom-vs-generic parameter plans and repeated
  before/after timings. Stop if the generic plan cannot exploit the index.
- Repeat with realistic branch-specific queue volume and writes before a
  proposed production rollout; account for locks and index-maintenance cost.
- Verify print-once, direct/approved reprint, different-branch denial and
  kitchen routing on isolated DB; FIFO/price work is independent (#486).
- For a real deployment, specify proper online index creation and rollback;
  the older candidate's bare `SET LOCAL` is **not** a production rollout plan.
- Separate owner approval is required for *any* production DDL.

## Next action

1. Restore exact-head CI by aligning the mandatory worklog branch.
2. Review experiment outputs on a disposable local/staging database; no
   production experiment without separate approval.
3. Continue scoped FIFO and approved raw-price SQL profiling without writes;
   measure before proposing one index at a time.

## Mandatory update protocol

Single writer. No direct `main` changes, no force push, no automatic
production migration. Stop and reconcile branch/main drift; keep this log
up to date with every branch change and CI gate.
