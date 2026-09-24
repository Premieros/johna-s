# WORK AUTHORIZATION UI-FIRST — LIVE WORK LOG — 2026-09-24

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/work-authorization-ui-20260924`
Current PR: `#355`
Last updated: 2026-09-24 14:58 Africa/Cairo

## Work status

State: **BLOCKED**

- Current phase: UI-first scaffold and stable client contract.
- Production enforcement: not started.
- Production migration: not applied.
- Main merge: not approved.
- UI preview must remain non-authoritative until the server authority phase is complete.
- Previous stale branch `development/work-authorization-gate-20260923` is superseded for implementation because it was 240 commits behind current `main`.
- Fresh baseline: `main@189973bb04e6ea81e766d2cea568ccbe7ab6c8da`.

## Guardrails

- Permission-First only; no new role-name authorization.
- Super Admin remains the only implicit bypass.
- No direct writes to `main`, no force push, no RLS weakening, no test removal.
- Printing / Print Agent / printer routing / KDS / send-to-kitchen are frozen and out of scope.
- No Production migration until exact-head Full Verify Green + explicit user approval.
- UI preview must not write to Production tables or invoke work-authorization RPCs before those RPCs exist and are verified.
- Existing operational approvals continue to work unchanged.
- Existing login/session flow stays unchanged during UI-first phase.

## Baseline

- Latest main at work restart: `189973bb04e6ea81e766d2cea568ccbe7ab6c8da`.
- Main includes PR #354 performance root fix.
- Existing `ApprovalCenterPage` still owns the live operational approval queue and approval policy management.
- Existing one-shot `approval_requests` remains unsuitable as the work-session source of truth because it is action-scoped, time-limited and consumable.
- Current canonical permissions include `approvals.review`, `approvals.override`, and `approvals.policy.manage`.
- A mandatory worklog CI gate now requires this file to match the PR branch and remain structurally updated.

## Root-cause ledger

1. The requested control is a shift/branch work-session authorization, not a one-shot manager approval.
2. Building backend first would lock the UX contract too early and increase rework risk.
3. Building UI with direct Supabase calls would create coupling and make later server hardening disruptive.
4. Therefore the approved architecture is:
   `UI shell -> typed client contract -> mock preview provider -> reviewed UX -> DB/RLS/RPC -> real provider -> server enforcement`.
5. The preview must be clearly labeled and non-authoritative so it can be reviewed without affecting branch operations.

## Change ledger

### 2026-09-24 — restart on fresh main

- Created `development/work-authorization-ui-20260924` from `main@189973bb04e6ea81e766d2cea568ccbe7ab6c8da`.
- Confirmed old work branch had diverged by 240 main commits and will not be used for implementation.
- Confirmed approval center and canonical permission files on current main before writes.
- Declared this new mandatory active work log.
- Opened Draft PR #355 for staged UI-first implementation.
- Planned UI deliverables:
  - manager center tabs: Pending / Working now / History / Settings;
  - mobile-first cards and desktop responsive layout;
  - employee waiting-state preview;
  - typed client contract;
  - mock provider only;
  - explicit preview marker;
  - zero Production data writes.

## Verification ledger

- Latest-main check: PASS — `main@189973bb04e6ea81e766d2cea568ccbe7ab6c8da`.
- Parallel-work check: PASS for this scope; open PR #352 is print-agent-only and remains out of scope.
- Old branch drift check: FAIL for reuse (240 commits behind main), therefore superseded safely.
- Code tests: pending implementation.
- Build: pending implementation.
- Fast Verify: pending.
- Full Verify: pending.

## Production gate

State: **BLOCKED**

- No Production migration exists for this UI-first phase.
- No work-authorization server enforcement is active.
- No merge to `main` until UI tests/verify are green and user reviews the staged interface.
- No Production activation until backend authority, RLS, RPC coverage, exact-head Full Verify Green, and explicit user approval.

## Next action

1. Add the typed work-authorization client contract and mock provider.
2. Build the manager UI preview with four tabs.
3. Build the employee waiting-screen preview.
4. Integrate preview mode into the existing Approval Center without changing live approval behavior.
5. Add UI contract tests.
6. Run targeted verification and update this log before the next code group.

## Mandatory update protocol

- Before every write group: read this log and latest `main`/branch state.
- After every code group: append exact changed files and behavior to `Change ledger`.
- After every test/workflow: record the exact result in `Verification ledger`.
- Before PR/merge: update `Current PR`, branch head, drift status, and `Production gate`.
- If any scope touches printing/KDS/send-to-kitchen unexpectedly, stop that change and record it here.
- This file and `docs/CURRENT_WORK_PLAN.md` are the source of truth; conversation memory is not.
