# SYSTEM HEALTH BRANCH PULSE — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/system-health-branch-pulse-20261003`
Current PR: `#439`
Last updated: 2026-10-03

## Work status
State: **BLOCKED**

Implementation is isolated from Production. Merge requires exact-head Full Verify Green and explicit approval. Production application is a separate approval.

## Guardrails
- No direct write to `main`; no force push.
- No Dashboard changes.
- No Print Agent, KDS, settlement, inventory deduction, accounting posting, or shift mutation changes.
- System Health presentation remains read-only.
- Branch Pulse uses one bounded domain RPC for all permitted branches.
- Zero orders or zero sales alone never classify a branch as unhealthy.
- Printing status must distinguish accepted submission from physical print confirmation.
- Error telemetry stores only bounded structured fields required for diagnosis.
- Existing `audit_log` remains an operational audit trail and is not repurposed for client errors.
- No Production schema/data/history mutation during implementation.

## Baseline
- Base: `main@7873cea47fca31b371cddf0775fbd6e589e57838`.
- Existing System Health uses `get_system_health_snapshot(p_branch_id)`.
- Existing System Health permission is `settings.manage`.
- Production has no dedicated error telemetry table.
- Branch Pulse source tables exist for branches, orders, sales, cloud print jobs, purchases, expenses, and shifts.
- Cloud print `submitted` means the system accepted the print call; it is not proof of physical paper output.

## Root-cause ledger
1. Current System Health shows invariants but not recent activity by branch.
2. Quiet branches and branches with cross-signal failures are not distinguished clearly.
3. User-facing errors are transient and cannot be safely aggregated today.
4. Reusing `audit_log` would mix business audit evidence with telemetry.
5. Physical print success cannot be inferred from the current print contract.

## Change ledger
- Added forward-only repository migration `20261003150000_system_health_branch_pulse.sql`:
  - private `user_issue_events` table with direct authenticated access revoked;
  - bounded `record_user_issue` capture RPC with auth, branch guard, rate limit, field caps, and secret-pattern rejection;
  - read-only `get_user_issue_summary` for System Health aggregation;
  - read-only `get_branch_activity_snapshot` for all permitted branches in one RPC.
- Branch Pulse uses selected period activity for orders, completed sales/net value, print submissions/failures, purchases, expenses, and current open shifts/operators.
- Quiet branches are explicitly neutral; warnings are cross-signal only.
- Printing remains truthful: submitted means accepted by the system/OS boundary; physical confirmation remains separate.
- Added `src/lib/userIssueTelemetry.ts` with safe redaction and fire-and-forget capture.
- Central capture wired to error Toasts and ErrorBoundary only; no per-screen mutation fanout.
- Added `BranchPulsePanel` inside System Health with 30m / 1h / 3h / 6h / 12h / Today / 24h / Custom, Problems only, branch cards, and user issue aggregation.
- Added unit and Fresh DB integration coverage.
- Updated frontend API contract for the three new RPCs.
- Production writes/applies: **none**.

## Verification ledger
- Production schema/status/index inspection: read-only only.
- Confirmed no dedicated Production error/telemetry table exists before this work.
- Confirmed cloud print `submitted` semantics from the canonical printing migration.
- Static safety contract added: `tests/unit/systemHealthBranchPulseContract.test.ts`.
- Fresh DB security/ACL integration added: `tests/integration/system_health_branch_pulse.test.ts`.
- Verify #3693 / workflow `37131235991` on `f0473da0d572edc397f1cdfdf9e2d4c44362601a`: **verify Green / db Green / browser-smoke Green**.

## Production gate
State: **BLOCKED**

No Production apply is authorized. Forward-only migration may be committed and validated in CI only.

## Next action
Run one final exact-head Full Verify after this worklog-only sync. If Green and `main` is unchanged, mark PR #439 ready and merge under the user's explicit approval. Production apply remains separately blocked.

## Mandatory update protocol
- Reconcile latest `main` and branch head before material writes.
- Unexpected divergence => **STOP_AND_RECONCILE**.
- Keep this log synchronized with code and verification.
- Keep State **BLOCKED** until exact-head Full Verify is Green and merge is explicitly approved.
