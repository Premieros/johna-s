# POS table read reuse

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `perf/pos-table-read-reuse-20261113`
Current PR: `#636`
Last updated: 2026-11-13 13:29 UTC / 15:29 Cairo

## Work status
State: **BLOCKED** pending complete verification. Draft only; not deployed.

## Guardrails
Preserve branch/RLS scope, order items, kitchen sends, realtime cadence and print
execution. No production DDL, business writes, credential changes or migrations
are included. Do not merge or deploy on incomplete/failed checks.

## Baseline
Main source posOrders.ts blob d4ef40ff590b11315c362d1e85c2cbf019f38f88.
Every live snapshot reads active tables separately and again through each order.
The earlier product SELECT InitPlan change was approved/applied separately in
20261113131737 and recorded in PR635. This PR does not modify that policy.

## Root-cause ledger
Confirmed redundant work: per-order dining-table hydration duplicates the active
table response already read in the same snapshot. Its contribution to total host
CPU has not been measured. This is not proof of the original outage cause.

## Change ledger
Remove only the orders query's embedded dining_tables relation. Hydrate table
details from the concurrently loaded active-table response. Fetch distinct missing
references in a single branch-filtered fallback, preserving inactive-table details
without adding inactive tables to the floor plan. Fail incomplete fallback reads.
No table data is cached across snapshots or users.

## Verification ledger
10 focused tests in 3 files passed: active/inactive/missing table hydration,
deduplicated scoped fallback, failure preservation, empty snapshots, bounded
notification reads, branch switching and unmount cleanup.
Changed-file ESLint passed.
First broad local UI run produced timeout failures in unrelated screen/report/
paging files under concurrent validation; it was stopped, not counted as passed.
Full local lint/build/typecheck were stopped to reduce contention. A bounded full
UI retry also hit timeouts and was stopped. Exact-head CI 43434233317 passed lint,
API contract, source identity and Pages continuity/build, but caught a new nullable
table mismatch in application types. Correct the missing-table representation to
the existing optional DiningTable contract and rerun checks. No overall CPU saving
is inferred from query shape. Full CI remains required after this correction.

## Production gate
No merge/deployment until full required exact-head checks succeed and production
publication is authorized. No actual branch sale or print was executed for testing.

## Next action
Complete isolated/bounded verification and investigate any reproducible failures.
Verify all CI jobs at the final head before considering publication.

## Mandatory update protocol
Update this log and the active plan after new findings/check results/releases.
Report failures and incomplete checks explicitly; never claim deployment from
passing focused tests alone.
