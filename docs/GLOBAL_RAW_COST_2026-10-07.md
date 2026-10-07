# GLOBAL RAW COST — ACTIVE WORK LOG
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `codex/global-raw-cost-20261007`
Current PR: `#467`
Last updated: 2026-10-07
Execution mode: **SINGLE_WRITER**
Parallel execution: **FORBIDDEN**
Unexpected HEAD policy: **STOP_AND_RECONCILE**
Write mode: **SEQUENTIAL_ONLY**

## Work status
State: **IN_PROGRESS**
User authorized latest raw-material prices throughout current calculations.

## Guardrails
No production changes. No permissions, RLS or Financial Visibility changes.
No new SECURITY DEFINER function; keep existing internal privileges unchanged.
No real sales/send/print tests. Actual FIFO layers and historical ledgers immutable.

## Baseline
Main 627b379b073cb06e4be071303676af293172c8ce; isolated worktree.

## Root-cause ledger
Current costing replaced known purchase/count/manual prices with inventory avg_cost.
Depleted raw materials can have avg_cost zero despite recorded positive prices.
Invoice Johna's-02525 snapshot contains unpriced components; 37.8694 is partial.

## Change ledger
Implemented latest-price resolver and consumers. Latest positive authoritative event by date, deterministic
source/reference/id ties, then positive inventory/batch/catalog fallback.
Read paths retain existing RLS; restricted users see only accessible price sources.
Explicit Financial Visibility guards also protect nested existing costing definers.
Final review corrected explicit SQL event column aliases; re-verification required.

## Verification ledger
Local application/test typechecks, build and lint pass. New unit scenarios cover
missing component cost, negative ledger signs, latest estimates, void/refund
proration and purchase unit scaling. Full suite and isolated CI database pending.

## Production gate
State: **BLOCKED**
User approved completion through publication at 22:41 Cairo on 2026-10-07.
Publication remains blocked until exact-head Full Verify is green.
No production write has occurred.

## Next action
Implement unified price resolver, current-price consumers and incomplete cost checks.

## Mandatory update protocol
Reconcile expected heads before writes; freeze tested head during CI.
