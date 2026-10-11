# Kitchen pending production fixes — 2026-10-11

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Baseline: `main@3e2420543700258c9754a1af7234d4043ff30f0f`
Branch: `fix/kitchen-fifo-print-warehouse-20261011`
Current PR: #490 (draft; awaiting separate production approval)
Last updated: 2026-10-11

## Work status
State: **BLOCKED** — code and migration proposed; production index migration and frontend deployment are NOT applied, and no additional live testing is planned at the user's request. Exact-head CI and a separate production/schema approval are required before any rollout.

## Guardrails
- Stop operational test orders, resend trials and unnecessary live printer checks. User explicitly requested to stop testing and address the remaining problems.
- Never modify production orders, warehouses, material quantity, FIFO debts, journal/COGS or print idempotency keys.
- Keep the #488 production `trg_capture_kitchen_ingredient_prices` disabled; the single-target emergency migration `20261011063452` already ran and is deliberately NOT repeated by this branch.
- No direct writes to `main`. Do not merge/deploy or apply new production DDL without authorization.
- Permission-First and branch-scoped warehouse authority remain mandatory.

## Baseline
- Current `main` is `3e2420543700258c9754a1af7234d4043ff30f0f`, prior to the unmerged emergency draft PR #488.
- Live production has the #488 price-trigger pause applied, confirmed `tgenabled='D'`; new operational price snapshots may report unknown price. New frontend code must not re-enable or reinterpret the price trigger.
- Prior two Cleopatra live orders `Johna's-02894` and `02895` had valid branch/warehouse scope, matched event component quantities and reported kitchen/bar cloud jobs; operator confirmed physical printing. No Smoha operational test requested now.

## Root-cause ledger
- Production `get_open_order_print_state(uuid)` sometimes times out on `cloud_print_jobs` receipt/open-check prefix lookup. `EXPLAIN` chose `idx_cloud_print_jobs_claim` on branch only and filtered `kind` and `idempotency_key LIKE 'open-check:<order>:%'` afterward. The unique key on (branch,idempotency) is not collated for efficient LIKE-prefix range search.
- Independent kitchen-send timeouts occurred in `_raw_remove_fifo` via `_raw_price_oversold_batch_from_fifo -> _raw_last_known_fifo_cost`. The latest priced FIFO issue and purchase receipt candidate queries filter raw material + branch + warehouse, then sort newest first; production explain used raw-material-only index and additional filtering/sorting.
- Client `fetchBranchWarehouseId` ignored `orders.maybeSingle()` errors and missing order records, allowing an unrelated branch fallback in availability/check-out UI. This could diverge from the server's immutable linked-order warehouse; production audit did NOT detect existing order or stock mismatches, so no data migration is justified.
- Read-only live cardinalities at diagnostic time: `inventory_ledger` 36,468 rows, `cloud_print_jobs` 12,296 rows, raw priced FIFO issue 18,358 rows, priced purchase/receipt 1,334 rows. Estimate-only indexes still need staging query-plan and write-cost review.

## Change ledger
- Proposed forward-only migration `20261011083000_kitchen_fifo_print_lookup_indexes.sql`: branch-keyed `text_pattern_ops` print receipt index, exact-predicate partial newest-known-FIFO issue/receipt indexes, and partial real-batch index. No function, grant, RLS, trigger, journal, order, or inventory data changes.
- POS warehouse resolver now fails closed when a linked order fetch errors or returns no matching branch row, and when warehouse fetch errors. Valid unsent orders still select deterministic first active/default warehouse and sent orders retain their pinned warehouse.
- Added source contract test for index SQL target/guardrails and warehouse lookup behavior. No production test orders or print attempts performed.

## Verification ledger
- Read-only PostgreSQL schema and index check: production `get_open_order_print_state` and `_raw_last_known_fifo_cost` definitions inspected; partial index predicates mirror canonical SELECT filters.
- Prior real operational test evidence belongs to #488 and Issue #489, not to this un-applied follow-up.
- Static source review of the POS warehouse resolver confirms that the previous missing-order/error branch could silently fall back.
- **Tests paused by user:** no new live order, print, stock mutation or performance load tests. Automatic repository CI is a non-production preflight gate, not a user-operated live smoke test; require exact-head Green before permission to merge.

## Production gate
- User requested fixing outstanding problems without continuing operational tests; this authorizes preparation, NOT silent application of new production index DDL.
- New forward-only migration is UNAPPLIED; deployment remains **BLOCKED** pending separate approval, CI and staged plan verification. SQL uses short lock and execution timeouts to fail instead of holding a busy POS lock.
- No old FIFO accounting price, warehouse default flag, branch assignment, receipt history, or cloud print job is rewritten.

## Next action
- Draft PR #490 opened against main; exact-head automatic CI is pending and is NOT a live test of production.
- Inspect exact-head CI and the differential SQL before proposing a separate authorized production rollout. Avoid further live order tests as requested.
- Investigate any further warehouse selection UI symptom from logs rather than changing historical order warehouse IDs.

## Mandatory update protocol
- Single writer; no direct `main` commits and no force pushes.
- Stop and reconcile any unexpected branch or `main` head movement.
- Exact-head Full Verify Green required before merge; deployment and production schema migration require separate explicit approval.
- Protect branch warehouse isolation, existing order pinning, FIFO cost authority, print idempotency, journal invariants and current production price-trigger pause.
