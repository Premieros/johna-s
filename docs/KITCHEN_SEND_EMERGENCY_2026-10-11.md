# KITCHEN SEND / PRINT EMERGENCY — 2026-10-11

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Baseline: `main@3e2420543700258c9754a1af7234d4043ff30f0f`
Branch: `hotfix/kitchen-send-trigger-latency-20261011`
Migration: `20261011060000_pause_blocking_kitchen_price_snapshot.sql`

## Work status
**PROPOSED / NOT APPLIED** — requires exact-head Full Verify Green and separate explicit production migration approval. No live SQL, kitchen sends, physical printing, warehouse rebinding, or sales mutations performed by this hotfix preparation.

## Root-cause ledger
- Merged PR #482 added a row-level BEFORE INSERT trigger to `order_kitchen_inventory_events`. It executes `get_raw_material_current_prices(branch, raw_ids)` synchronously on every event. That canonical reader traverses purchase inventory ledger, historical purchase items, stock-count prices, price events, and permission/history checks. This work is repeated per order line while a live order is locked and BEFORE the frontend invokes the print dispatch.
- Production logs after #482 contain PostgreSQL `57014` statement timeouts with exact call stack: `send_to_kitchen -> _send_to_kitchen_core_20260914 -> INSERT order_kitchen_inventory_events -> _capture_kitchen_ingredient_prices -> get_raw_material_current_prices -> private.financial_row_visible`, notably 2026-10-10 14:13:48 UTC. This is a proven kitchen send failure path, not merely a hypothesis.
- Other timeouts in FIFO batch summation and subsequent event update also appeared; disabling the added trigger may not resolve every existing or unrelated kitchen timeout. Do not claim all kitchen/warehouse/print defects resolved by this proposal.
- Since merge, 605 kitchen cloud-print queue jobs were recorded as `submitted`, with mean creation-to-submission 2.1s and p95 2.6s. `submitted` is agent submission, not physical paper confirmation. Queue time does NOT include the preceding send RPC; a timed-out send never enqueues printing.
- Live warehouse audit for 871 kitchen events since #482 showed zero invalid, wrong-branch, or order-vs-event warehouse mismatches; thus no evidence supports automatically reassigning warehouses. Cleopatra's single active warehouse is marked `is_default=false`, but the current server send resolver falls back to the first active warehouse; investigate client UI separately, do not rewrite historical warehouse binding.

## Emergency mitigation
Only pause `trg_capture_kitchen_ingredient_prices` using the guarded, single-target migration. Do NOT disable other inventory-event triggers, the kitchen send RPC, FIFO consumption or print queue. Keep original function and historical snapshots untouched for a future optimized reactivation.
**Important cost trade-off:** After apply, new snapshots do not contain frozen approved material prices. Sales/station cost reports will show partial/unknown prices for those sends, and later price backfills are prohibited. This is deliberate loss of a *report projection* to protect the live order-send path; FIFO stock cost/accounting totals continue through their existing independent logic. Owner must approve this trade-off explicitly.

## Change ledger
- 2026-10-11: Inspected production migration presence, live trigger, call stack, cloud print metrics, warehouse integrity, and repo POS send/dispatch source.
- Prepared a reversible, guarded migration that changes only the trigger enable flag. No trigger/function body rewrite and no live database action.
- Added scoped contract test for trigger targeting and preservation of send/print/warehouse paths. Updated mandatory work-plan pointer.

## Verification ledger
- **Read-only production:** trigger was enabled at time of diagnosis; latest migration `20261009141910 kitchen_sale_known_price_snapshot` is applied. Logs show one or more send RPC statement timeouts in its cost lookup.
- Post-#482 cloud queue (at analysis time): 605 kitchen jobs submitted, 0 job error messages in examined records; do not equate `submitted` with physically printed.
- Post-#482 kitchen warehouse events: 871 checked / 0 wrong branch / 0 differing from order warehouse / 0 missing warehouse.
- Required before applying: exact-head Full Verify, staging kitchen first send + added quantity resend + idempotent retry, FIFO negative batch, cancellation, station routing and queue; run with the trigger disabled in isolated DB and assert missing report prices render unknown.
- Required after separately approved production apply: verify trigger `tgenabled='D'`, check send endpoint latency/errors before/after, verify warehouse ID and single stock deduction, check cloud queue submission, physical ticket print at BOTH branches, then monitor journal/shift side effects.
- Re-enable only after a bounded indexed price snapshot implementation is tested, and only under separate authorization.

## Mandatory update protocol
- Single writer; do not write main directly; do not force push.
- Stop and reconcile unexpected main/branch movement.
- Run exact-head full CI and inspect failure logs before requesting merge, deployment or SQL approval.
- No production schema, function, policy or trigger changes without explicit user approval; preserve permissions, financial visibility, transaction integrity and historical costing.
