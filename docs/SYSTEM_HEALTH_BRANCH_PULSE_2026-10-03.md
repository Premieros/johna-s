# SYSTEM HEALTH BRANCH PULSE — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/system-health-branch-pulse-20261003`
Current PR: `#0`
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
- Pending implementation.

## Verification ledger
- Production inspection performed read-only.
- Exact-head CI: pending.

## Production gate
State: **BLOCKED**

No Production apply is authorized. Forward-only migration may be committed and validated in CI only.

## Next action
Implement Branch Pulse read RPC, safe error-event capture/read path, period controls, problems-only view, and regression/security contracts.

## Mandatory update protocol
- Reconcile latest `main` and branch head before material writes.
- Unexpected divergence => **STOP_AND_RECONCILE**.
- Keep this log synchronized with code and verification.
- Keep State **BLOCKED** until exact-head Full Verify is Green and merge is explicitly approved.
