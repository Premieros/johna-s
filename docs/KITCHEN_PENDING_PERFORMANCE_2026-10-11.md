# Kitchen pending production fixes — 2026-10-11

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Baseline: `main@0f2bd306eb5eb925960b6581d1b40cd1312ecd2f` (emergency #488 merged; applied Supabase migration retained)
Branch: `fix/kitchen-fifo-print-warehouse-20261011`
Current PR: #490 (code-only merge authorized after exact-head Full Verify; index rollout separate)
Last updated: 2026-10-11

## Work status
State: **BLOCKED** — reconciling code-only PR #490 with merged #488. New exact-head Full Verify required before frontend merge/deploy. Index candidate is NOT in canonical migrations, has never been applied, and requires separate production authorization. No operational test orders.

## Guardrails
- Stop operational test orders, resend trials and unnecessary live printer checks. User explicitly requested to stop testing and address the remaining problems.
- Never modify production orders, warehouses, material quantity, FIFO debts, journal/COGS or print idempotency keys.
- Keep the #488 production `trg_capture_kitchen_ingredient_prices` disabled; the single-target emergency migration `20261011063452` already ran and is deliberately NOT repeated by this branch.
- No direct writes to `main`. Do not merge/deploy or apply new production DDL without authorization.
- Permission-First and branch-scoped warehouse authority remain mandatory.

## Baseline
- Current `main` is `0f2bd306eb5eb925960b6581d1b40cd1312ecd2f`, INCLUDING now-merged emergency PR #488. Price trigger pause was already applied under owner approval; no replay or new SQL by #490.
- Live production has the #488 price-trigger pause applied, confirmed `tgenabled='D'`; new operational price snapshots may report unknown price. New frontend code must not re-enable or reinterpret the price trigger.
- Prior two Cleopatra live orders `Johna's-02894` and `02895` had valid branch/warehouse scope, matched event component quantities and reported kitchen/bar cloud jobs; operator confirmed physical printing. No Smoha operational test requested now.

## Root-cause ledger
- Production `get_open_order_print_state(uuid)` sometimes times out on `cloud_print_jobs` receipt/open-check prefix lookup. `EXPLAIN` chose `idx_cloud_print_jobs_claim` on branch only and filtered `kind` and `idempotency_key LIKE 'open-check:<order>:%'` afterward. The unique key on (branch,idempotency) is not collated for efficient LIKE-prefix range search.
- Independent kitchen-send timeouts occurred in `_raw_remove_fifo` via `_raw_price_oversold_batch_from_fifo -> _raw_last_known_fifo_cost`. The latest priced FIFO issue and purchase receipt candidate queries filter raw material + branch + warehouse, then sort newest first; production explain used raw-material-only index and additional filtering/sorting.
- Client `fetchBranchWarehouseId` ignored `orders.maybeSingle()` errors and missing order records, allowing an unrelated branch fallback in availability/check-out UI. This could diverge from the server's immutable linked-order warehouse; production audit did NOT detect existing order or stock mismatches, so no data migration is justified.
- Read-only live cardinalities at diagnostic time: `inventory_ledger` 36,468 rows, `cloud_print_jobs` 12,296 rows, raw priced FIFO issue 18,358 rows, priced purchase/receipt 1,334 rows. Estimate-only indexes still need staging query-plan and write-cost review.

## Change ledger
- Index SQL was deliberately moved OUT of `supabase/migrations` into `scripts/experiments/kitchen_fifo_print_indexes_candidate_20261011.sql`: proposed branch-keyed `text_pattern_ops` print receipt index, exact-predicate partial FIFO issue/receipt indexes and partial real-batch index. GitHub's Supabase integration may automatically apply canonical migrations on main merge; this unapproved production DDL must never be auto-run. Proposal remains unexecuted. No function, grant, RLS, trigger, journal, order or inventory data changes.
- POS warehouse resolver now fails closed when a linked order fetch errors or returns no matching branch row, and when warehouse fetch errors. Valid unsent orders still select deterministic first active/default warehouse and sent orders retain their pinned warehouse.
- Consolidated the isolated, in-flight-only cloud print queue list-read coalescing from #487 into #490. Keyed by branch and bounded limit, authentication changes clear the map, failures are not cached and enqueue/claim/start/complete jobs are untouched.
- Added source contract tests for the UNAPPLIED SQL candidate, including an assertion that it is absent from canonical migrations, and warehouse lookup plus the previously green #487 concurrent print queue/agent protocol test suite. No production test orders or print attempts performed.

## Verification ledger
- Read-only PostgreSQL schema and index check: production `get_open_order_print_state` and `_raw_last_known_fifo_cost` definitions inspected; partial index predicates mirror canonical SELECT filters.
- Prior real operational test evidence belongs to #488 and Issue #489, not to this un-applied follow-up.
- Static source review of the POS warehouse resolver confirms that the previous missing-order/error branch could silently fall back.
- #487 initial CI Full Verify was Green; its queue-read change and relevant 2 test files were ported directly without modifying agent RPCs. Its SQL index suggestion is superseded by the broader, still-unapplied #490 index migration.
- **Tests paused by user:** no new live order, print, stock mutation or performance load tests. Automatic repository CI is a non-production preflight gate, not a user-operated live smoke test; require exact-head Green before permission to merge.

## Production gate
- User requested fixing outstanding problems without continuing operational tests; this authorizes preparation, NOT silent application of new production index DDL.
- Candidate indexes are UNAPPLIED and NOT a canonical migration. The frontend changes may be merged after owner-approved exact-head Full Verify; a separate index production rollout needs explicit new approval and plan/write-lock validation. The candidate's transaction/lock behavior must be reviewed before execution; never run it directly on a busy POS.
- No old FIFO accounting price, warehouse default flag, branch assignment, receipt history, or cloud print job is rewritten.

## Next action
- #488 is merged in main; #487 was closed as superseded after #490 previous exact-head Full Verify `38122811325` Green.
- #490 is reconciled to main preserving #488; its new *code-only* exact-head CI is mandatory. No new live production tests.
- Inspect exact-head CI and the differential SQL before proposing a separate authorized production rollout. Avoid further live order tests as requested.
- Investigate any further warehouse selection UI symptom from logs rather than changing historical order warehouse IDs.

## Mandatory update protocol
- Single writer; no direct `main` commits and no force pushes.
- Stop and reconcile any unexpected branch or `main` head movement.
- Exact-head Full Verify Green required before merge; deployment and production schema migration require separate explicit approval.
- Protect branch warehouse isolation, existing order pinning, FIFO cost authority, print idempotency, journal invariants and current production price-trigger pause.
