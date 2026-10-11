# Kitchen send-time approved ingredient price performance — 2026-10-11

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/kitchen-approved-price-candidate-20261011`
Current PR: #491
Last updated: 2026-10-11
Issue: #486; independent index investigation #489

## Work status
State: **BLOCKED** — candidate only, automatic SQL deployment and any production trigger enable are prohibited.

## Guardrails
**EXPERIMENT / NOT READY FOR PRODUCTION.** Owner said continue after successful merge, but has NOT separately authorized any new production function/index DDL or re-enabling the kitchen ingredient-price trigger. Do not apply the experimental SQL in production, put it under `supabase/migrations`, or deploy it. Do not create test orders or printer jobs in real stores.

Known production state: Supabase migration `20261011063452` already paused only `trg_capture_kitchen_ingredient_prices` (`D`); `trg_sync_sale_source_order_from_kitchen_event` remains enabled (`O`). FIFO deductions, order warehouse pinning, printing, financial postings are independent and untouched.

## Baseline
Baseline main: `3cb08d52b028e393ecbfd46409afd8a8292ac278` after #488 + #490.

## Root-cause ledger
- The old `_capture_kitchen_ingredient_prices()` runs the comprehensive `get_raw_material_current_prices(branch, raw_ids)` **once per kitchen inventory event** in a BEFORE INSERT trigger. At busy times this repeated expensive request timed out and aborted `send_to_kitchen`.
- `get_raw_material_current_prices` collects completed purchase ledger events, UOM-normalized legacy purchase items not already represented by ledger, applied stock count items and manual pricing events; sorts by event time, source rank, reference number, event ID. Older purchase visibility requires `private.financial_row_visible()` with per-user history visibility; no simplification of auth/RLS is permitted.
- Live read-only table cardinalities at investigation: 36,515 inventory ledger rows, 798 purchase items, 1,369 stock-count items, 296 raw-material pricing events and 805 raw materials. `pg_stat_statements` cumulative `get_raw_material_current_prices` RPC 284 calls, mean ~2.07s and max ~7.85s (historic aggregate, not current sends).
- Previous trigger rejects prices from `last_batch`, `inventory_average` and `default_cost` even if the price getter returns them. Unknown historical prices must stay unknown; FIFO COGS and journal valuations must not be replaced with operational snapshot estimates.
- Found an as-of edge case: old getter first picks the globally latest approved candidate, then the trigger rejects it if `priced_at` exceeds the kitchen event timestamp. It can fail to use a valid older approved event. The candidate filters eligible approved events before choosing the winner. This is an intentional as-of correctness improvement; must be regression tested and separately approved, not retroactively applied.

## Change ledger
- `scripts/experiments/kitchen_approved_price_bounded_candidate_20261011.sql`: a new `STABLE SECURITY INVOKER` price candidate (NOT a migration). Uses at most one most-recent qualified source row per material from purchase ledger, legacy purchases, stock counts and manual pricing; ranks the four candidates with the original tie-break ordering and a strict `p_as_of` cutoff. Keeps purchase `financial_row_visible`, SQL-level branch scope and underlying RLS, approved-only source whitelist and legacy receipt de-duplication.
- The source candidate does not modify existing kitchen triggers or even call the current trigger. No new indexes or write paths in this PR.
- `tests/integration/kitchenApprovedPriceCandidate.test.ts`: rollback-only isolated database fixture (no live order), price precedence across manual/stock-count/purchase sources, time cutoffs, branch scoping, no fallback, canonical parity under manager role, trigger remains disabled. This test creates the candidate function in the transaction and rolls it back.
- `tests/unit/kitchenApprovedPriceCandidateContract.test.ts`: static gate preventing auto-Supabase migration or production trigger change and guarding finance/branch/time predicate parity.

## Verification ledger
- First head CI 38125918065 stopped at mandatory worklog format contract, before executing SQL integration tests. This update corrects the required format; fresh exact-head Full Verify is mandatory.
- Tests described below run in an isolated rollback-only CI database, not production.

## Production gate
- Candidate is NOT in Supabase canonical migrations and trigger stays disabled. Separate approval is required for any new DDL or trigger state change.

## Next action
1. Exact-head Full Verify green, including SQL compilation on fresh integration DB and rollback-only role/price regression.
2. Full numeric/NULL/tie/reference/UOM parity matrices for ledger, mixed legacy purchases, applied count, manually priced, denied user, future-dated, missing timestamps. Investigate any historical exceptions.
3. Safe representative production-equivalent database with real cardinality; EXPLAIN (ANALYZE, BUFFERS) on isolated fixture/replica, median/p95 and write overhead. **Never benchmark with live production orders.**
4. Design batching at kitchen send transaction level to prevent repeated lookups across order lines if bounded source lookups are still slow. Prove NO delayed or retrospective price capture.
5. Propose a separate canonical migration with guarded trigger replacement and rollback plan, permission grants audited, staged first-send/resend/FIFO/printing tests, independently approved production apply. Preserve `D` until this is all green.
6. Never backfill old snapshots, reprice invoices or change inventory FIFO/accounting, warehouse mapping or print idempotency.

## Mandatory update protocol
One writer, no direct `main` write, no force push. Reconcile unexpected GitHub head or schema drift before continuing. Keep mandatory work plan pointer aligned with this branch. The latest production change was merged #490; this draft does not automatically deploy SQL.
