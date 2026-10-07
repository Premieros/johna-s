# GLOBAL RAW COST — ACTIVE WORK LOG
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `codex/global-raw-cost-20261007`
Current PR: pending
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
Pending implementation. Latest positive authoritative event by date, deterministic
source/reference/id ties, then positive inventory/batch/catalog fallback.
Read paths retain existing RLS; restricted users see only accessible price sources.

## Verification ledger
Pending local checks, isolated database integration and exact-head Full Verify.

## Production gate
State: **BLOCKED**
Separate approval required for migration; merge requires exact-head green and approval.

## Next action
Implement unified price resolver, current-price consumers and incomplete cost checks.

## Mandatory update protocol
Reconcile expected heads before writes; freeze tested head during CI.
