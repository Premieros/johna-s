# POS table read reuse

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `perf/pos-table-read-reuse-20261113`
Current PR: `#636`
Last updated: 2026-11-13 13:50 UTC / 15:50 Cairo

## Work status
State: **DEPLOYED**. User authorized completing, merging and publishing. PR636
merged as c885794b160cf337182d165932fd5bcb4733407f; actual Pages publication succeeded.

## Guardrails
Branch/RLS scope, order items, kitchen sends, realtime cadence and print execution
are preserved. No production DDL, business writes, credential changes or migration
were included. No actual branch sale or print was executed for testing.

## Baseline
Original posOrders.ts blob d4ef40ff590b11315c362d1e85c2cbf019f38f88. Every snapshot
read active tables separately and again inside each open order. The earlier,
separately approved product SELECT InitPlan migration 20261113131737 is recorded
in PR635; this frontend release does not modify that policy.

## Root-cause ledger
Confirmed redundant work: repeated per-order dining-table hydration despite the
same snapshot already loading active tables. Its contribution to total CPU has
not been measured; this is not proof of the original outage cause.

## Change ledger
Reuse the current table response to hydrate order.table. Fetch distinct missing
references in one branch-filtered fallback to retain inactive-table details,
without inserting inactive tables into the active floor plan. Fail incomplete
fallback reads, preserving the last good snapshot. No cross-snapshot/user cache.

## Verification ledger
10 focused tests passed. Changed-file ESLint passed. Initial broad local runs
hit timeout failures under contention and were stopped. The baseline finance
suite passed independently (12 tests). A prior CI run caught a nullable-table
mismatch; corrected absent details to the existing optional DiningTable type.

Final PR head 9c25634eb0c93e5fb0d06ee637ba66e295a7c0e6 passed Verify main
43434706409: lint, app/test types, 2,106 frontend tests, 1,284 DB/RLS tests
(1 pre-existing optional skip), retained assets/build, both browser shards and
browser-smoke aggregation. Post-merge Verify main 43436112815 also succeeded.

Actual Pages run 43436701018 succeeded: build, production API parity, deployment.
Native public HTTP verification returned 200 and confirmed the deployed entry
index-BNERDDZv.js references format-B-CHtwug.js (12,677 bytes), SHA256
5a998233568e9e1bd90c368dda5d418053b359e486ecb6ffaf7bbe23252cfd6c.
The service chunk contains the new order select without the embedded table join;
the exact old full-snapshot select is absent. Baseline format-CeZRuzay.js contained
the old repeated relation. Overall host CPU reduction is not measured.

## Production gate
Authorized release complete. No forced client reload, database restart or agent
change. Existing sessions receive the code on their next normal reload/open.

## Next action
Observe normal operational reads when users load the release; investigate further
load only with a separate bounded measurement. Do not infer a CPU percentage.

## Mandatory update protocol
Keep this log and the active plan synchronized after findings or release changes.
Do not claim live sale/printing tests or total CPU savings from these checks.
