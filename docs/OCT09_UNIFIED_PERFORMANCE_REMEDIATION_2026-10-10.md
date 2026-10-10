# October 9 production incident — unified remediation work log (DRAFT / NOT DEPLOYED)

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/oct09-kitchen-payment-performance-20261010`
Current PR: `#487`
Last updated: 2026-10-10 12:33 Africa/Cairo

## Work status
State: **BLOCKED**. Draft PR only; exact-head verify, database parity, performance regression and explicit production approval required.

## Guardrails
No direct main edits, no live migration, no printing or stock accounting changes without isolated tests; retain permission-first, FIFO and branch isolation.

## Baseline
main at 3e242054, production October 9 error evidence in issue #486. PR #482 trigger active in production.

## Root-cause ledger
Investigations and uncertainty appear in Evidence below. 57014 timeouts have multiple contexts, not a single proved culprit.

## Change ledger
- `eb26074d` shared only concurrent identical listCloudPrintQueue reads; no response cache and no print dispatch change.
- `6e9d6d42` added cloud queue concurrency tests.
- `30ce10b7` added static send-time price-snapshot contract tests.
- `a90ff90f` aligned active work plan pointer, and this update repairs structural CI gate.
- No database SQL modified.

## Verification ledger
Prior run 38043888489 failed active-worklog branch mismatch. Run 38044214412 failed missing required headings and metadata. No other suite had run because the gate stopped it. Tests must run on exact next head.

## Production gate
Separate explicit production approval required after complete exact-head CI and benchmarked DB implementation; no live change authorized by this draft.

## Next action
Run exact-head Full Verify; fix test failures; implement safe DB price batching with source/authorization parity, then verify remaining FIFO and print-read timeouts.

## Mandatory update protocol
On every change, append verified commit, test evidence, impact assessment, and remaining blockers to this worklog; no assumption of successful deployment.


Repository: Premieros/johna-s
Production: azzdesuowpdcoflmyezn
Base: main
Branch: fix/oct09-kitchen-payment-performance-20261010
Issue: #486

## User-approved direction (2026-10-10, latest and controlling)
Keep **operational ingredient prices frozen at Send to Kitchen**, NOT at payment. User approved performance optimization with unchanged payment flow, FIFO deductions, kitchen prints, station dispatch, and reporting semantics. Target fewer repeated branch-scoped price queries, preferably collect distinct raw ids once per send transaction; preserve per-event send-time source/price/timestamp and NULL for unknown costs. Do not turn repeated lookups into cross-user or cross-branch cached financial data. Fix other proven October 9 incident contributors in the same tracked remediation but in isolated, verifiable increments.

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
1. **Batch kitchen price lookup (risk: HIGH):** Keep send-time snapshot and existing trigger semantics unless a proven equivalent implementation passes tests. Investigate scoping a single price query over distinct raw ids for all new order events within one authorized transaction. Avoid per-event price RPC repetition. Preserve trigger isolation, financial row visibility and event-specific recorded timestamp; no session/global financial cache. Explicitly validate re-send quantities, missing costs, mixed warehouses, permissions and transactions with concurrent edits.
2. **Price-source contract:** Match the existing approved `purchase`, `pricing` and `stock_count` events, tie-breaking, timestamp cutoff, branch and user financial visibility. No fallback to today's newer price; no FIFO cost substitution. Verify price equality at frozen event time on integration fixtures before replacing trigger behavior.
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

## Important design blocker
The existing BEFORE INSERT trigger invokes price resolution per qualifying kitchen event. Replacing it requires coordinating all new event rows, and matching price snapshots and security under concurrent kitchen sends; naive application-level batching or cache introduces race conditions. Do not move to payment or deactivate the trigger before an equivalent DB-atomic solution is verified.

## Delivery state
Investigation + dependency mapping only. No executable change, tests or production migration claimed.
## Latest focused investigation — 2026-10-10
- Production `_raw_last_known_fifo_cost` performs up to three recency lookups (negative FIFO issue, latest receipt ledger, latest real batch), then a default price fallback. Inventory ledger only has isolated raw-id and warehouse indexes and branch/created-time index; the sampled empty-identifier EXPLAIN chose `idx_inventory_ledger_warehouse_id` and a sort. It is not a measured real-key baseline.
- Added `scripts/diagnostics/oct09_fifo_cost_readonly.sql` to gather read-only inventory ledger indexes and statement counters on a controlled diagnostic environment. No changes to production function, indexes or data.
- Exact-head Full Verify run 38044573460 green on commit 9b21ed75 (verify, DB, pages-continuity, browser). Subsequent documentation/diagnostics changes require new exact-head CI.
- Blocking: representative safe latency comparison before index migration, DB-atomic price batching and parity fixtures, unresolved Oct 9 FIFO/refund/printing query timeouts.

## FIFO index candidate — 2026-10-10
- Read-only production count: inventory_ledger 35,012 entries; 17,518 records match negative non-oversold positive-cost predicate. Counts do not measure selectivity per material/branch/warehouse.
- Staged *UNAPPLIED* `scripts/experiments/oct09_fifo_issue_index_candidate.sql`: concurrent partial covering index matching `_raw_last_known_fifo_cost` negative-issue predicate and its ordering, plus static SQL contract test in `tests/unit/fifoIssueIndexCandidate.test.ts`. This is NOT an authorized migration or production change.
- Evaluate under representative keys and write load on isolation fixture before promoting to generated migration; account for index insert overhead and `CONCURRENTLY` nontransactional execution.
- Full Verify 38046468821 on prior head 7e122c7a passed four jobs; latest candidate commits require exact-head rerun.

## FIFO scope distribution, live read-only evidence — 2026-10-10
- Matching negative real FIFO ledger rows 17,597 across 299 raw-material/branch/warehouse scopes; mean 58.9, p95 191.7, maximum 2,017 rows per scope. These are actual production *counts*, not query latencies or proof of a missing index.
- `scripts/diagnostics/oct09_fifo_cost_readonly.sql` now includes aggregate-only scope distribution query. Candidate index remains un-applied; safe representative-index plan comparisons and concurrent writer-load tests are still required.
- Previous exact-head Full Verify 38048248906 at ed285899 green (4/4), branch-agent claim/start/complete unchanged. Subsequent diagnostic commit needs new exact-head CI.
