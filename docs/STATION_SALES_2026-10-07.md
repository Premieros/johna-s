# STATION SALES — ACTIVE WORK LOG
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `codex/station-sales-20261007`
Current PR: `#466`
Last updated: 2026-10-07
Execution mode: **SINGLE_WRITER**
Parallel execution: **FORBIDDEN**
Unexpected HEAD policy: **STOP_AND_RECONCILE**
Write mode: **SEQUENTIAL_ONLY**

## Work status
State: **IN_PROGRESS**
User authorized preparation of station/category sales report.

## Guardrails
Read-only reporting. No migration, policy, sale, settlement, shift, inventory,
KDS or printing flow changes. No real sales/send/print tests.

## Baseline
Main 0e81c8c79dd4b1009888eb0c6c23db07278ae960 (#465). Isolated worktree.

## Root-cause ledger
Existing sales-by-product report has no station dimension or detailed allocation.
Station belongs to category; historical station snapshot is absent.

## Change ledger
Detailed bounded sales reads; allocate invoice discount/tax before item filtering.
Current catalog station/category labels explicitly disclosed. Exact kitchen
source costs where traceable; unavailable cost never becomes zero profit.

## Verification ledger
Application/test typechecks, changed-file lint and build passed.
1,540 tests passed; initial documentation gate needed the newly assigned PR number.
Exact-head Full Verify pending.

## Production gate
State: **BLOCKED**
No production writes. Merge requires exact-head Full Verify green and approval.

## Next action
Implement, verify, open review PR and request publication approval.

## Mandatory update protocol
Reconcile expected heads before writes; freeze tested head during CI.
