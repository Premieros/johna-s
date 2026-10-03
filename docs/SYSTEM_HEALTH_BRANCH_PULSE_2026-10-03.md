# SYSTEM HEALTH BRANCH PULSE — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/system-health-branch-pulse-production-closure-20261003`
Current PR: `#440`
Last updated: 2026-10-03

## Work status
State: **BLOCKED**

Implementation PR #439 is merged and the approved Production migration has been applied successfully. This closure branch only reconciles repository documentation with the verified Production state. No further Production mutation is authorized by this closure PR.

## Guardrails
- No direct write to `main`; no force push.
- No Dashboard changes.
- No Print Agent, KDS, settlement, inventory deduction, accounting posting, or shift mutation changes.
- System Health presentation remains read-only.
- Branch Pulse uses one bounded domain RPC for all permitted branches.
- Zero orders or zero sales alone never classify a branch as unhealthy.
- Printing status distinguishes accepted submission from physical print confirmation.
- Existing `audit_log` remains separate from client-error telemetry.
- No additional Production schema/data/history mutation in this closure branch.

## Baseline
- Implementation merged to `main@4b55bb50c768a0650e99fbe7500bc95a0fda70c5`.
- PR #439 merged from exact head `92730adaccbf3ce07ddcd69702fec8a5bd04a26f`.
- Exact-head Verify #3694 / workflow `37134438863`: verify Green / db Green / browser-smoke Green.
- Approved Production migration source: `supabase/migrations/20261003150000_system_health_branch_pulse.sql`.
- Production migration history entry: `20261003160107 system_health_branch_pulse_20261003`.

## Root-cause ledger
1. System Health previously showed operational invariants but not recent activity per branch.
2. Quiet branches and cross-signal failures were not differentiated.
3. User-visible errors were transient and had no bounded aggregation channel.
4. Reusing `audit_log` would have mixed business audit evidence with telemetry.
5. Print submission is not physical-paper confirmation and must remain labelled truthfully.

## Change ledger
- Added Branch Pulse with 30m / 1h / 3h / 6h / 12h / Today / 24h / Custom windows.
- Added per-branch orders, completed sales/value, print submitted/failed status, purchases/value, expenses/value, open shifts/operators, and cross-signal warnings.
- Added explicit neutral `quiet` branch state.
- Added Problems only filter.
- Added private `user_issue_events` telemetry storage with direct authenticated/anon table access revoked.
- Added bounded `record_user_issue`, `get_user_issue_summary`, and `get_branch_activity_snapshot` RPCs.
- Central error capture is fire-and-forget from Toast and ErrorBoundary.
- Production migration applied only after explicit user approval.

## Verification ledger
- Pre-apply: new table and all three RPCs absent from Production.
- Production apply result: success.
- Post-apply:
  - `private.user_issue_events` exists and RLS is enabled.
  - authenticated/anon direct SELECT/INSERT on telemetry table are denied.
  - anon EXECUTE on all three new RPCs is denied.
  - authenticated EXECUTE on intended RPC surface is present.
  - all three RPCs return `AUTH_REQUIRED` without an authenticated identity.
  - telemetry row count remained 0 after guard verification.
  - live read-only Super Admin Branch Pulse returned success for 2 branches.
  - live read-only issue summary returned success with 0 issue groups.
- Supabase advisors:
  - private telemetry table reports RLS-with-no-policy INFO; this is intentional because direct table access is revoked.
  - the three public guarded RPCs report the existing SECURITY DEFINER executable warning class; auth/permission/branch checks remain inside each RPC.
  - performance advisor reports an unindexed `user_id` foreign key on telemetry; no follow-up Production mutation was made without separate approval.
  - unused-index notices on the two new indexes are expected immediately after creation.

## Production gate
State: **BLOCKED**

The approved Branch Pulse Production migration is **APPLIED AND VERIFIED**. State remains BLOCKED only because the repository worklog contract requires the literal while this documentation-only closure PR is open. Any additional Production change, including a telemetry `user_id` index, requires a separate approval.

## Next action
Merge this documentation-only closure after exact-head CI is Green. Keep ERP-05 Production migration separate and unapplied until explicitly approved.

## Mandatory update protocol
- Reconcile latest `main` and closure branch head before merge.
- Unexpected divergence => **STOP_AND_RECONCILE**.
- Do not perform additional Production mutation from this closure branch.
- Keep State **BLOCKED** while the closure PR is open to satisfy the repository gate.
