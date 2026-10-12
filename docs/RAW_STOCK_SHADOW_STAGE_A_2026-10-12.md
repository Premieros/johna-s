# Negative-first raw stock: live balance shadow, Stage A — 2026-10-12

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Baseline: `main@6673da6db4dbd9db1e018131a3d7f15db978c022`
Branch: `perf/raw-stock-live-balance-shadow-20261012`
Current PR: #493
Last updated: 2026-10-12

## Work status

State: **BLOCKED** — Stage A SQL and tests prepared only as a nonproduction
experiment. Earlier exact-head Full Verify passed on the TWO-cache candidate;
the simplified ONE-cache candidate requires a fresh exact-head Full Verify.
Isolated functional checks do **NOT** prove total database load is lower.
NO merge, deployment, production DDL, or live read-path cutover.

## Guardrails

- Owner approved a *faster negative-first balance architecture*, not the
  execution of production SQL, paid staging, merge, or deployment.
- Do not create real restaurant orders, physical printing trials or live
  inventory mutations to test. Do not delete/compact negative debt history.
- Keep every existing FIFO batch consumption, idempotency, purchase approval,
  count approval, source cost basis, ledger, journal, branch and warehouse scope.
- Never claim historical FIFO receipt settlement is O(1) when thousands of
  individual source-ledger rows must be reconciled.
- Only a fresh explicitly authorized production change may touch live schema.
- Other work: receipt print guard draft #492, approved kitchen snapshot #486
  and cashier receipt area routing are separate. Do not mix them into #493.

## Baseline

Read-only production verification on 2026-10-12:
- Refreshed read-only stock sampling: 18,075 raw batch rows, 16,769
  nonpositive (negative or depleted), only 1,306 positive; 551 distinct
  material/branch/warehouse keys. Historical negatives are the dominant
  workload, not an edge case.
- All 551 persisted branch balance rows matched the SUM of raw batches:
  no missing, extra, or unequal quantity rows. Reuse this existing official
  `raw_material_inventory` branch balance. Do not introduce a redundant
  branch shadow as another current-stock authority.
- Cumulative `pg_stat_user_tables` counters at inspection recorded
  ~49,367 raw batch UPDATEs and ~40,819 branch-inventory UPDATEs. These are
  not recent per-hour rates, but demonstrate why a new trigger UPSERT for
  each batch mutation is a serious write-amplification risk.
- `raw_material_warehouse_inventory` is a **nonmaterialized VIEW** that does
  SUM(quantity), SUM(quantity*unit_cost) by warehouse on every access.
- `raw_material_inventory` is a persisted BRANCH table, but _raw_add and
  _raw_remove_fifo first scan batches to recalculate it. Its BEFORE
  `_raw_inventory_actual_avg_cost_guard` separately scans **positive batches**
  for the displayed average. One cached quantity alone is insufficient.
- One Smoha material has >2,100 open FIFO debts. Total open debts observed
  ~11,515 across the project; purchases/counts can be expensive too.
- Existing `_raw_last_known_fifo_cost` prioritizes actual priced FIFO issue,
  purchase receipt, priced real batch, then raw default — neither an inventory
  average nor the kitchen dispatch-time approved sale-cost snapshot.

## Root-cause ledger

1. A negative kitchen send inserts oversold batch/debt while send-side
   `_raw_remove_fifo` sums all old batches per warehouse, then all batches
   per branch, even when there are no positive FIFO batches.
2. Purchase `_raw_add` does the same two SUMs and calls
   `_raw_fifo_settle_receipt` to settle oldest debts and reconcile historical
   source ledgers and financial references. A 15-unit receipt against -10
   stock should leave +5, with 10 settled, NOT +15 or a double deduction.
3. `apply_stock_count` computes `counted_quantity - current_quantity`.
   A physical count 5 against current -10 must post a +15 adjustment, settle
   10 debt via the existing add path and end at +5. Preserve count approval
   and the count/variance journal.
4. Multiple batch writers exist: _raw_add, _raw_remove_fifo, debt settlement,
   transfer, invoice update, repairs/backfills and admin operations. Updating
   balance in kitchen-only code would go stale; use a single transactional
   source-of-truth batch delta with catch-all row INSERT/UPDATE/DELETE.
5. RLS/financial security requires internal-only state; do not expose a
   permissive API or a SECURITY DEFINER public RPC for convenience.

## Change ledger

**Stage A candidate only:** `scripts/experiments/raw_stock_shadow_state_candidate_20261012.sql`

- **ONE** private, non-API warehouse shadow table per material/branch/warehouse;
  the existing persisted `raw_material_inventory` table remains the only
  authoritative branch-level balance. No second branch cache.
- One-time aggregate backfill while holding a staging-only
  SHARE ROW EXCLUSIVE batch write lock, then an AFTER row trigger on
  `public.raw_material_batches`. A normal batch mutation now triggers
  at most ONE warehouse UPSERT (previous proposal had TWO). Metadata-only
  updates that leave quantities/values unchanged perform ZERO counter writes.
  The delta is in the same transaction and sees final BEFORE-trigger costs.
- Handles insert, delete, price change, negative-to-zero, positive-to-zero and
  scope moves; revokes direct anon/authenticated access, enables RLS, and
  rejects untracked TRUNCATE.
- Stage A does **not** replace the existing warehouse view, branch stock
  write path, stock-count RPC, FIFO functions, price lookups, ledger or journals.
  This is intentional: we need parity and write-load proof first.
- Transaction bootstrap checks all four warehouse numeric aggregates.
  Branch quantity parity was independently checked against 551 production
  groups by read-only SQL; production bootstrap requires a new deployment plan.

**Rollback-only validation:** `scripts/experiments/raw_stock_shadow_rollback_fixture_20261012.sql`.
Temporary synthetic batch rows exercise -10 consumption then +15 purchase
(quantity +5 after 10-unit settlement), repricing, branch/warehouse moves,
deletion and savepoint rollback. It verifies **balance arithmetic**, NOT
the complete financial settlement or approved count RPC behavior.

Source contract: `tests/unit/rawStockShadowCandidateContract.test.ts`.
Local opt-in execution: `tests/integration/raw_stock_shadow_local_fixture.test.ts`,
which requires a pre-installed dedicated local PostgreSQL database and
`RAW_STOCK_SHADOW_LOCAL_DB_URL`. A skipped integration test is not proof.

## Verification ledger

- Reviewed production function definitions, relevant triggers, view, RLS
  exposure, table shapes and sample cardinality using read-only SQL only.
- Stage A candidate was committed to draft PR #493 outside canonical
  `supabase/migrations`; no production schema migration was added.
- Previous draft head `e1866a863d6d6fa30d5c2c2a793e8da1eb527f87`
  passed exact-head Full Verify, including 991 canonical DB integration
  tests and two actual local PostgreSQL shadow fixture tests. This verified
  the now superseded TWO-shadow proposal only; it is NOT proof the simplified
  single-shadow head has passed. Its new CI result must be checked separately.
- No write overhead, deadlocks, concurrency, finance parity, physical print
  or real-restaurant performance improvement has been claimed.

## Production gate

**Before any cutover:**
1. Run Stage A on a disposable isolated DB. Compare all 551-equivalent groups
   under raw negatives, zero/depleted rows, warehouse NULL/moves, price
   updates, return/refund, transfers and multiple users. Record data hashes.
2. Prove concurrent send/receipt/count, rollback, retry and source-cost
   settlement do not create stale state or deadlocks.
3. **Primary acceptance is NET DATABASE WORK REDUCTION**, not only a faster
   SELECT. Compare baseline vs Stage A+Stage B, with identical mixes of
   negative kitchen sends, receipts settling 1/100/2000 debts, physical
   counts, warehouse transfers and no-op updates. Capture CPU time, shared
   buffer hits/reads, WAL bytes, lock waits, deadlocks, p50/p95/p99, queue
   throughput and maintenance/autovacuum burden. If aggregate write/read
   burden rises, reject the approach and prefer smaller indexed queries.
4. Stage B is a **separate reviewed change**: remove redundant per-warehouse
   and per-branch batch SUMs from operation paths, read a warehouse balance
   by PK, and update the EXISTING official branch quantity once per
   logical operation, preserving concurrency semantics. The positive-only
   average guard scan must also be removed *safely*, including its
   no-positive-stock fallback. Stage A alone ADDS work; it must never be
   deployed as an optimization by itself.
5. Stage C, also separate, improves bounded FIFO-positive batch selection,
   priced last-known-cost lookup, and purchase/count debt settlement. The
   historical allocation per source remains exact; no asynchronous financial
   lag is introduced without explicit architecture approval.
6. Require exact-head Full Verify Green, a production-safe online lock and
   rollback/reconciliation plan, and separate owner approval for ANY live DDL.
   A stage-only blocking snapshot transaction is **not** that rollout plan.

## Next action

1. Run exact-head CI on draft PR #493 and correct any contract/style issue.
2. Provision no billable infrastructure automatically. Run explicit local
   rollback-only fixture once disposable PostgreSQL is available.
3. Benchmark **aggregate write + read consumption** in a negative-first
   workload and prepare Stage B only if it lowers pressure at equal
   correctness. A green unit/SQL fixture does not satisfy this requirement.
4. Do not merge #493 or switch the production stock read path silently.

## Mandatory update protocol

Single writer. No direct `main` commits, no force pushes. Unexpected head
movement: STOP_AND_RECONCILE. Keep active plan pointer synchronized with
this log and rerun exact-head CI after every commit. Stage-only scripts
remain outside automatic migrations. No production write without specific
owner approval.
