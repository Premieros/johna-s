# October 9 production incident — unified remediation work log (DRAFT / NOT DEPLOYED)

Repository: Premieros/johna-s
Production: azzdesuowpdcoflmyezn
Base: main
Branch: fix/oct09-kitchen-payment-performance-20261010
Issue: #486

## User-approved direction (2026-10-10)
Move **operational ingredient price computation** away from Send to Kitchen and into successful sale settlement / payment, while preserving send-time *as-of* price semantics where reproducible. Keep kitchen send, real inventory FIFO deduction, stock negative debts, printing and station dispatch as they are. Repair all related Oct 9 incident paths in one coordinated delivery only after isolated verification.

## Evidence: Oct 9, Egypt calendar day (UTC 2026-10-08 21:00 to 2026-10-09 21:00)
- 37 PostgreSQL SQLSTATE 57014 statement timeouts.
- Cost detail: 17 HTTP 500; trigger-side payment snapshot costs cannot explain pre-migration errors in all costing queries.
- Send to kitchen: 7 HTTP 500, with 8 matching SQL timeout contexts, not a one-to-one request count: kitchen inventory-event UPDATE (4), negative-stock last FIFO cost (2), raw batch (1), raw inventory UPSERT (1).
- Print jobs list: 6 HTTP 500; open-order print-state 1 HTTP 500; this does **not** prove failed physical prints.
- Raw-price RPC 2 HTTP 500; refund 1 HTTP 500 in raw debt receipt settlement FOR UPDATE; issue-report 13 HTTP 401 with SQLSTATE 42501 function execute denied.
- Production trigger `trg_capture_kitchen_ingredient_prices` is enabled and originates in PR #482; production migration table shows kitchen_sale_known_price_snapshot applied as version 20261009141910. This adds a price lookup to EVERY qualifying kitchen event. Historical timeout logs also predate this suspected migration; it is not the sole cause.
- Existing relevant indexes: `idx_raw_fifo_debts_open`, `idx_cloud_print_jobs_claim`, `idx_kitchen_inventory_events_order`, raw batch material/branch index. Do not duplicate them without measured plans.
- Recent related PRs: #478 report read coalescing, #479 accounting routing, #481 shared FIFO display prices, #482 frozen kitchen price, #484 POS client stock check removal. Never roll these back as a group.

## Safeguards and sequence (single PR, isolated commits)
1. **Price snapshot relocation (risk: HIGH):** Keep immutable send-time raw ingredient quantities and timestamp. Remove expensive price lookup trigger **only after** replacement sale-settlement path is implemented and tested. The payment settlement must write priced component snapshots within the authoritative *database* settlement transaction (not browser-only), before reporting sees sale settled. Replays via idempotency key, partial/split settlement, resends and offline outbox sync must never duplicate cost or change approved price. Explicitly handle unpaid sends, canceled/voided items and refunds.
2. **Historical price at send time:** Current `get_raw_material_current_prices(branch,ids)` returns *latest current price* and has no as-of argument. Applying `priced_at <= send_time` to that current-result set is **not equivalent** to querying the latest approved price **as of send time** if a newer price was created. Implement a permission-respecting historical as-of lookup using the same valid price sources, tie-break precedence, and NULL-for-unknown semantics; compare to existing frozen dispatch events. Preserve branch and financial visibility; do not use later prices or FIFO valuation as operational sale cost.
3. **Kitchen send performance and negative FIFO:** Isolate raw debt trigger `_raw_last_known_fifo_cost`, raw inventory UPSERT contention and event-id update. Lock/order/idempotency/negative debt and warehouse isolation preserved; measure statement plans with representative safe fixtures; never simply raise timeouts or remove transaction locks.
4. **Refund FIFO debt settlement:** Keep open-debt order and row locking semantics. Existing targeted index `idx_raw_fifo_debts_open` is present: inspect lock contention and scan cardinality before modifying.
5. **Cloud printing reads:** Review claim/list/status query shape against `idx_cloud_print_jobs_claim`, preserve unique idempotency key and printer jobs and expected states. Never change printer payload, paper format or station routing to solve DB reads.
6. **Report / costing reads:** Focus on repeated `financial_row_visible` and branch auth checks, not unauthorized SECURITY DEFINER bypass or broad caching. Compare same requester/scope before/after; preserve RLS and financial histories.
7. **Issue-report permissions:** Identify intended caller role and policy before adding narrowly scoped execute privilege. HTTP 401 not proof of session expiry. Do not grant `PUBLIC` without permission review.

## Mandatory verification gates
- Baseline and optimized SQL plans / elapsed time and representative buffer workload, *including under concurrent kitchen send and reports*.
- DB fresh integration with same permissions: successful/denied branches and users, prices changing between send and pay, missing prices, send/resend quantities, negative stock FIFO debt, split payment, offline queued sale retry, refunds/voids, identical saved costs, exact-once settlement.
- Frontend POS and local/cloud printing browser checks; cash drawer/station dispatch unchanged. Physical printer testing only if available; do not claim otherwise.
- Strict at-least-one-commit-per-change and full exact-head Verify green.
- Production SQL, merge and deployment all separately gated by user explicit approval per CURRENT_WORK_PLAN; no production changes during this draft.

## Important design blocker (not yet resolved)
Simply moving the old trigger to AFTER payment is **incorrect**: current-price lookup at payment time can overwrite historical send-time price and changing revenue/cost interpretation. Must build and prove true as-of source query in the settlement transaction first, then retire trigger safely. This is not yet a completed fix.

## Delivery state
Investigation + dependency mapping only. No executable change, tests or production migration claimed.