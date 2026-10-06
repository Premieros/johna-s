# HEAVY REPORT LOADS — ACTIVE WORK LOG
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `perf/heavy-report-loads-20261006`
Current PR: `#459`
Last updated: 2026-10-06

## Work status
State: **BLOCKED**
User requests continuing heavy pages and high resource consumption. Implement and
verify a concrete patch before requesting separate Production approval.

## Guardrails
Single writer; no direct main writes/force push. Preserve existing table RLS,
Financial Visibility, branch/history scope and report formulas. New read RPC must
be SECURITY INVOKER, never a definer shortcut. No stock/accounting data writes,
printing/Print Agent/POS/KDS/send_to_kitchen/shift changes or real transaction tests.
Usage Watch remains disabled. Production is read-only in this stage.

## Baseline
Main a656caf2c497aacb4c703ea9555a8acfe0dc4730, #458 completed and deployed;
post-merge Verify 37428702085 and Pages 37428702093 succeeded. #445 remains open
and excluded. New worktree preserves prior local work without resetting it.

## Root-cause ledger
ReportsPage displays 100 rows but loads every sales/purchase/expense row plus joined
names first. Full export/print uses those same rows. Costing Center loads suppliers
and raw unit maps regardless of active tab; a combined effect depends on all tab
callbacks, so unrelated selector/date changes rerun the active read.
Production pg_stat_statements inspected read-only; statistics are cumulative and
cannot establish current latency or current dominant traffic. Historical expensive
routes include dashboard snapshot, POS availability/order items and print-related
reads. Operational and printing paths stay frozen; no monitoring automation enabled.

## Change ledger
Implemented: new invoker bounded sales/purchase/expense page plus complete filtered
totals, joined metadata only for page rows; existing full loaders used on demand
for export/print. Applied date/filter snapshots retained across page navigation.
Implemented: independent active-tab Costing Center reads and lazy supplier/unit selectors.
No existing policy or function definition changed by the proposed page API.
Obsolete full exports abort HTTP/pagination on reader-scope changes; late supplier
selectors are discarded. Optional measurement-unit reads are branch-scoped.

## Verification ledger
Local targeted 26 tests, typecheck:all and build passed; full 306 files / 1486 tests passed after the subtitle assertion update. Added cancellation tests require a final verification head. Initial full unit run: 1485 passed / 1 stale subtitle-string contract failed; updated it to require applied export dates while retaining branch labels. Exact-head 2a6c1d06 / Full Verify 37434650041: lint/types/1489 unit tests/build and Pages continuity passed; DB failed during the new fixture setup (invalid expense status draft). Existing 910 DB/security tests passed, new 6 skipped due to that setup failure; browser skipped. Fixture corrected to the existing valid voided status; no production constraint weakened. Fresh full verification required. Required: empty/late/foreign
scope reads, >100 rows, identical direct-RLS totals/filters/history, export beyond
first page, applied-filter stability and no extra Costing Center reloads.

## Production gate
State: **BLOCKED**
New reporting migration requires exact-head Full Verify Green and separate explicit
user approval. No Production writes performed. Rollback: revert frontend; new read
function can remain unused or be removed by a separately approved migration.

## Next action
Implement bounded operational reports and Costing Center load reduction, run local
checks and isolated DB/security/browser CI, retain concrete evidence in the PR.
Raw consumption query-plan work, accounting #445 and unrelated security backlog
remain separately scoped; do not silently apply them.

## Mandatory update protocol
Recheck main/open PRs before writes; STOP_AND_RECONCILE unexpected source movement.
Record exact-head CI/deployment evidence in PR metadata without invalidating the
tested head. Keep CURRENT_WORK_PLAN linked to this single active log.
