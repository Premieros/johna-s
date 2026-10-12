# Johnas POS — FIFO total DB work review — 2026-10-12

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `perf/raw-fifo-total-load-review-20261012`
Current PR: `#494` (DRAFT; not approved for merge)
Last updated: 2026-10-12
State: **BLOCKED** for production; independent review and isolated CI only.

## Work status
- Proposed Stage A: `scripts/experiments/raw_fifo_receipt_settle_candidate_20261012.sql`.
- Proposed Stage B: `scripts/experiments/raw_stock_official_balance_delta_candidate_20261012.sql`.
- These are explicitly NOT canonical migrations; neither may run automatically.
- Work only on a separate branch based on `main@6673da6db4dbd9db1e018131a3d7f15db978c022`.
- Do not merge #493; its added per-batch shadow trigger is not accepted as an optimization.

## Guardrails
- No production write/DDL, no test orders or real printing; no release, PR merge, paid branch or resource.
- No deletion/backfill/repricing of historical debts, COGS, journal entries or inventory ledger.
- Preserve negative raw-stock consumption, same-branch material advisory locks, warehouse identity,
  stock-count permissions, and positive-only actual average cost BEFORE trigger.
- A single active warehouse today must NOT be hardcoded as a permanent invariant.

## Baseline
- GitHub issue #489; Draft PR #493 remains open and unmerged.
- Production read-only verification: `_raw_add`, `_raw_remove_fifo` aggregate batch quantities
  both per warehouse and branch; `_raw_inventory_actual_avg_cost_guard` scans positive batches.
- `_raw_fifo_settle_receipt` currently updates the same receipt batch inside every settled-debt loop.
- Existing positive FIFO index is `(branch_id,warehouse_id,raw_material_id) WHERE quantity>0`
  and does not match FIFO sort `expiry_date NULLS LAST,created_at,id`.
- Original inventory parity: 551/551 material-branch groups; 11k+ debts open (owner audit).
- Prior shadow experiment: 1,200 writes took 1.66ms plain / 25.49ms with trigger; reject for total workload.
- Baseline main commit verified: `6673da6db4dbd9db1e018131a3d7f15db978c022`.

## Root-cause ledger
1. Repeated branch SUM after purchase and negative kitchen FIFO; positive-cost guard causes a further scan.
2. Receipt settles per-source debts correctly but rewrites the same positive batch for each source.
3. Positive FIFO index lacks FIFO ordering, so large historic nonpositive populations cause extra work.
4. Stock-count variance reads warehouse stock before helper lock; stage candidate serializes the read.
5. Branch balance is NOT equivalent to one warehouse's balance when several warehouses exist.

## Change ledger
- Stage A adds a review-only positive FIFO ordered partial index and moves receipt-batch
  quantity update outside the debt loop; all debt/estimate/source-ledger/COGS/journal adjustments
  remain inside the loop, with the same early exits and accepted allocations.
- Stage B applies signed atomic deltas to `public.raw_material_inventory` once per helper call.
  It intentionally retains the warehouse-specific SUM for FIFO before/after and a branch-SUM
  fallback only when an official summary row is missing.
- The unchanged positive-cost BEFORE trigger still computes `avg_cost`; do not optimize it
  by inventing a new positive-only cache until total workload is proven.
- `apply_stock_count` now takes the same material/branch transaction advisory lock before
  determining the warehouse variance, avoiding a stale read versus a concurrent kitchen send.
- Existing source functions were captured read-only from live definitions; this is staged SQL
  not applied to production.

## Verification ledger
- Static contract test: `tests/unit/rawFifoTotalLoadCandidateContract.test.ts`.
- Executable DB test: `tests/integration/raw_fifo_total_load_review.test.ts` against localhost-only
  disposable CI PostgreSQL. Uses an outer transaction and rollback, matched BEFORE/AFTER
  12-negative-debt purchase replay, second warehouse, exact FIFO source-cost/COGS parity,
  stock count after negative, one-time count application and retry guard.
- Query plan captures `EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON)` receipt execution time,
  buffer hits/reads/writes and WAL bytes/records before and after.
- GitHub Actions run 38240332039 failed at mandatory active-worklog branch pointer (old kitchen branch versus this review branch); DB job skipped. This is a CI gate blocker, not proof of SQL correctness. A single synthetic sample cannot establish
  CPU, p95/p99, two-session lock waits or net production workload savings. 100/2000-debt
  load, busy branch concurrency, end-to-end send/print testing are not yet validated.
- Production RLS/schema/trigger snapshots remain unchanged by this work.

- Read-only production refresh: 11,551 open debts across 135 material/branch/warehouse keys,
  largest 2,168, p95 group size 365.5; 1,305 positive versus 16,793 nonpositive
  raw batches, and 551 stored branch summaries.
- CI 38242687106: verify/pages PASS, 991 established DB tests passed;
  first candidate integration fixture failed on UUID/text parameter inference (42P08), fixed.
- CI 38243475520: verify/pages PASS, 991 established DB tests passed;
  candidate fixture reached an important schema drift: production `_raw_fifo_settle_receipt`
  references `raw_fifo_debt_price_estimates` and `raw_fifo_price_fallback_runs`,
  absent from repository canonical migration CI replay. New TEST-ONLY schema parity
  fixture is `scripts/experiments/raw_fifo_price_estimate_parity_local_20261012.sql`,
  executed only in rollback-only localhost tests. This DOES NOT repair the canonical
  migration gap and must not be promoted to production.
- To avoid misleading comparison of different historical definitions, the fixture
  derives the original per-debt-update baseline from the same production-captured
  settlement function used in the optimized case. Test work is still in progress.

## Production gate
State: **BLOCKED**
- Do not ship even if static + CI integration tests pass. Need independent staging load
  with realistic 1/100/2000-debt mix and multiwarehouse/transfer/void/repair cases, write/WAL
  overhead for new index, lock waits/deadlocks, CPU/buffers and p50/p95/p99.
- Reconcile real schema/function definitions and exact-head CI; prepare a CONCURRENTLY index
  rollout and rollback plan with permissions, then request explicit owner approval.
- No automatic schema migration, production SQL, physical tests, merge or deployment.

## Next action
1. Complete branch/PR worklog and inspect exact-head Full Verify.
2. Fix failing SQL behavior in staged candidates only, rerunning the isolated DB fixture.
3. Report a genuine before/after total-load comparison including possible regressions.
4. Keep PR #493 in draft without merging.

## Mandatory update protocol
Single writer. No main commits, no force pushes. On unexpected branch or main movement:
STOP_AND_RECONCILE. Preserve this log and synchronize `docs/CURRENT_WORK_PLAN.md`.
Any production migration/index/trigger and any paid staging requires separate explicit approval.
