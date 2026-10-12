# Negative-first raw stock: live balance shadow, Stage A — 2026-10-12

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Baseline: `main@6673da6db4dbd9db1e018131a3d7f15db978c022`
Branch: `perf/raw-stock-live-balance-shadow-20261012`
Current PR: #493
Last updated: 2026-10-12

## Work status

State: **BLOCKED** — architecture approved; Stage A SQL and tests prepared
as a **nonproduction experiment** only. Exact-head Full Verify, a disposable
local PostgreSQL instance, transactional/parallel integration tests and
recorded benchmarks are still required. **No production deployment or cutover.**

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
- `raw_material_batches`: ~18,063 rows; ~11,430 negative rows, ~5,327 zero;
  ~551 (material,branch,warehouse) groups and ~551 (material,branch) groups.
  Every then-existing batch had a warehouse, but the legacy column is nullable.
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

- Two private, non-API state tables: one row per material/branch and one per
  material/branch/warehouse (including negative balances), each storing
  signed quantity/value and positive-only quantity/value.
- One-time aggregate backfill while holding a bounded
  SHARE ROW EXCLUSIVE batch write lock, then install an AFTER row trigger on
  public.raw_material_batches. The trigger increments both state scopes in
  the SAME transaction and uses final batch prices after existing BEFORE hooks.
- Handles insert, delete, price change, negative-to-zero, positive-to-zero and
  scope moves; revokes direct anon/authenticated access, enables RLS, and
  rejects untracked TRUNCATE.
- Stage A does **not** replace the existing warehouse view, branch stock
  write path, stock-count RPC, FIFO functions, price lookups, ledger or journals.
  This is intentional: we need parity and write-load proof first.
- Transaction bootstrap checks all four numeric aggregates at both scopes.
  Production cannot safely run this bootstrap without quiet-window planning.

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
- Exact-head GitHub CI status and isolated PostgreSQL transactional fixture
  results are not yet verified in this log.
- No write overhead, deadlocks, concurrency, finance parity, physical print
  or real-restaurant performance improvement has been claimed.

## Production gate

**Before any cutover:**
1. Run Stage A on a disposable isolated DB. Compare all 551-equivalent groups
   under raw negatives, zero/depleted rows, warehouse NULL/moves, price
   updates, return/refund, transfers and multiple users. Record data hashes.
2. Prove concurrent send/receipt/count, rollback, retry and source-cost
   settlement do not create stale state or deadlocks.
3. Measure added trigger row-upsert overhead at peak writes. Do not trade
   one historical scan for an unacceptable per-batch lock queue.
4. Stage B, in a **separate reviewed change**, replaces only the repeated
   batch SUMs used for the live balance by indexed single-key reads after
   parity. It must also replace the **positive-only average guard scan**
   consistently, respecting its existing no-positive fallback behavior.
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
3. Benchmark with representative negative-first material counts; prepare a
   separate Stage B plan only after measured parity and write cost.
4. Do not merge #493 or switch the production stock read path silently.

## Mandatory update protocol

Single writer. No direct `main` commits, no force pushes. Unexpected head
movement: STOP_AND_RECONCILE. Keep active plan pointer synchronized with
this log and rerun exact-head CI after every commit. Stage-only scripts
remain outside automatic migrations. No production write without specific
owner approval.
