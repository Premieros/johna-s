# WORK AUTHORIZATION UI-FIRST — LIVE WORK LOG — 2026-09-24

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/work-authorization-ui-20260924`
Current PR: `#355`
Last updated: 2026-09-24 17:00 Africa/Cairo

## Work status

State: **BLOCKED**

Execution mode: **SINGLE_WRITER**
Parallel execution: **FORBIDDEN**
Unexpected HEAD policy: **STOP_AND_RECONCILE**
Write mode: **SEQUENTIAL_ONLY**

- Current phase: final mutation-time server guard verification.
- Architecture: `Login -> Work Authorization Gate -> Application`.
- Authorization scope: **user + branch only; independent of shifts**.
- Feature flag: `VITE_WORK_AUTHORIZATION_GATE=0` by default.
- Production migration: not applied.
- Production feature activation: not enabled.
- Main merge: not approved.
- Printing / Print Agent / printer routing / KDS / send-to-kitchen remain untouched by this feature.

## Guardrails

- Permission-First only; no role-name authorization.
- Super Admin is the only implicit bypass.
- No direct writes to `main`.
- No force push.
- Do not weaken RLS or tests.
- No Production migration before exact-head Full Verify Green + explicit user approval.
- No Production feature activation before migration verification + explicit approval.
- Existing login/session hydration behavior must remain unchanged.
- CloudPrintAgent must remain outside the work-authorization gate.
- No polling for work authorization state.

## Baseline

- Fresh implementation branch was created from `main@189973bb04e6ea81e766d2cea568ccbe7ab6c8da`.
- Old branch `development/work-authorization-gate-20260923` was superseded because it was heavily behind current main.
- Existing Approval Center remains the home for operational approvals and the new work-authorization center.
- Existing one-shot `approval_requests` is not reused as the durable entry-authorization source of truth.
- Mandatory active work log CI points to this file.

## Root-cause ledger

1. The desired control is a centralized entry permit, not repeated permission polling throughout the application.
2. Authorization must be separate from authentication: valid login does not automatically mean work access.
3. Work authorization should not depend on shift lifecycle; opening/closing a shift must not force repeated approvals.
4. Final model:
   `Authenticated -> Branch Access -> Work Authorization Gate -> Application`.
5. Server RPCs remain authoritative for protected writes; frontend gate is the user experience layer.
6. Realtime is used only as a wake-up signal, followed by one state RPC refresh.
7. Stopping authorization must immediately move the user from active/working to pending/waiting.

## Change ledger

### UI / application boundary

- Added typed work-authorization client contract.
- Added mock provider for initial preview.
- Added RPC-only Supabase provider.
- Added centralized `WorkAuthorizationGate.tsx`.
- Added `WorkAuthorizationAppBoundary.tsx`.
- Mounted the boundary around operational application routes.
- Kept `CloudPrintAgent` outside the gate.
- Added active-branch switching inside the waiting gate.
- Added Realtime subscription wake-up for authorization/policy changes.
- No polling loops were introduced.
- Approval Center uses the real provider only when `VITE_WORK_AUTHORIZATION_GATE=1`.
- Approval Center uses:
  - `work.authorization.approve` for review/approve/reject/revoke;
  - `work.authorization.manage` for policy settings.
- Approvers may access Approval Center while their own authorization is pending to prevent deadlock.

### Permissions

- Added canonical:
  - `work.authorization.approve`
  - `work.authorization.manage`
  - `work.authorization.bypass`
- `work.authorization.approve` depends on `approvals.review`.
- `work.authorization.manage` and `work.authorization.bypass` depend on `work.authorization.approve`.
- No role-name authorization path was added.

### Backend migration

Branch-only migration:

`supabase/migrations/20260924164500_work_authorization_backend.sql`

Contains:

- `work_authorization_policies`
- `work_authorizations`
- `work_authorization_events`
- indexes / uniqueness
- RLS
- hardened RPCs
- audit writes
- Realtime publication guard
- capability-based permission seeding

Final authorization lifecycle is independent of shifts:

- no `shift_id` in authorization state;
- shift open/close does not bind, consume, revoke, or expire authorization;
- approved authorization persists until explicitly revoked, policy-disabled, branch access removed, or account deactivated.

### Stop authorization behavior

Final required behavior:

1. manager sees approved active users per branch in **Working now**;
2. manager presses **Stop authorization**;
3. active row becomes `revoked`;
4. if policy still requires authorization, a new `pending` request is created/reused atomically;
5. `can_user_work` becomes false immediately;
6. Realtime wakes employee gate;
7. employee returns to waiting screen;
8. fresh approval is required before re-entry.

### Mutation-time server enforcement

- Full Verify #2666 / run `36013208864` was **FULL GREEN** on pre-enforcement head `c5a5df72fc37059c2860217af57c121ae3808bbf`:
  - mandatory worklog gate ✅
  - lint/typecheck/unit/build ✅
  - Fresh DB + migrations/schema ✅
  - integration/security/RLS ✅
  - Browser Smoke ✅
- Added branch-only migration `supabase/migrations/20260924170000_work_authorization_mutation_guard.sql`.
- Enforcement is server-side at mutation time only; it does **not** poll and does not add a frontend round-trip.
- `assert_user_work_authorized_cached(branch_id)` caches the successful user+branch decision transaction-locally, so one transaction does not repeatedly re-query authorization.
- Generic mutation trigger is attached only to curated operational branch tables.
- Explicit exclusions preserve independence and safety:
  - printing: `cloud_print_jobs`, `cloud_print_wake_state`;
  - KDS/kitchen transport tables: `order_kitchen_*` / kitchen tables;
  - shift lifecycle: `shifts`, `daily_closes`, `business_day_state`;
  - work authorization / approval tables themselves.
- Service/background calls without an authenticated employee identity remain outside the employee work gate.
- Added integration coverage proving:
  - exact guarded table set;
  - printing/KDS/shifts/work-authorization tables are not guarded;
  - operational mutation is rejected with `WORK_AUTHORIZATION_REQUIRED` while waiting;
  - the same mutation succeeds after approval;
  - one transaction stores the expected work-authorization guard cache key.
- Added user-facing `WORK_AUTHORIZATION_REQUIRED` mapping so a rare revoke/action race shows a clear waiting-for-approval message rather than a technical database error.

### Tests

- Added UI contract tests for:
  - no role-name guards;
  - RPC-only provider;
  - default-off feature flag;
  - centralized gate;
  - no polling;
  - CloudPrintAgent isolation.
- Added integration tests for:
  - fail-open rollout;
  - policy management branch scope;
  - idempotent pending request;
  - self-approval denial;
  - cross-branch approval denial;
  - approve -> allowed;
  - revoke -> pending -> blocked;
  - reapprove -> allowed;
  - shift open/close does not change authorization;
  - direct writes denied;
  - audit/events created.


### 2026-09-24 — Single-writer drift prevention

- Root cause of execution drift: the unified plan contained many historical sections still labelled `ACTIVE`, and an unexpected commit was incorrectly attributed to “parallel work”.
- User confirmed there is **no parallel writer**.
- Added `docs/SINGLE_WRITER_EXECUTION_FENCE.md`.
- Only the branch declared in the mandatory execution gate is executable.
- Other historical `ACTIVE` sections are backlog/history only unless explicitly promoted by the user.
- Repository writes are sequential only; reads may remain parallel.
- Every successful write commit becomes the expected HEAD for the next write.
- Before every write: fetch branch HEAD and require an exact match.
- Unexpected HEAD => stop, inspect commit metadata/files, reconcile active log; never invent a second worker.
- After interruption/tool conflict/timeout/cancel: re-read branch HEAD + active log + execution gate before resuming.
- While an exact-head Verify is running, no additional writes unless a real failure requires a fix.
- This protocol is mandatory and will be enforced by CI contract tests.
- Single-writer fence files:
  - `docs/SINGLE_WRITER_EXECUTION_FENCE.md`
  - `docs/CURRENT_WORK_PLAN.md`
  - `tests/unit/activeWorklogGateContract.test.ts`
  - `docs/EXECUTION_GUARDRAILS.md`
- Final fence rollout checkpoint before verification: expected branch HEAD before this log write was `84b17faeef61d935d0924ae401600ce0c879e51f`.

## Verification ledger

- Fast Verify #356 mutation-guard migration failure: `raw_material_warehouse_inventory` is a **view**, so PostgreSQL rejected the generic `BEFORE INSERT/UPDATE/DELETE` trigger. No Production impact; failure occurred on Fresh DB before schema/integration.
- Removed that view from the trigger set and from the exact trigger-list integration assertion. Physical raw inventory remains protected through `raw_material_inventory` and `raw_material_batches`.


- Verify #2664 / Fast Verify #349 reached Green on DB migration/schema/integration and Green on lint/typecheck. One unit assertion failed because `workAuthorizationUiFirstContract.test.ts` still expected the old `canManagePolicies` prop name after the live Work Authorization center moved to `canManageWorkAuthorization`. Runtime code was correct.
- Fixed that single stale assertion at commit `afdff9e4fb875c62a7338be4c5c044d6c5846eaf` without changing runtime behavior or weakening coverage.


- UI-first pre-backend Verify was Full Green.
- Pre-migration preparation Verify #2604 was Full Green.
- First backend verification caught explicit test typing/lint issues; they were fixed without weakening checks.
- Fresh DB previously proved the initial migration structure before later architecture changes.
- Fast Verify #322 exposed:
  - three unnecessary regex escapes in the UI contract test;
  - invalid final Realtime `DO $` delimiter in the migration.
- Both were corrected:
  - regex normalized;
  - Realtime block uses named `$realtime$ ... $realtime$` delimiter.
- CORRECTION: commit `6f0328d7ead08cd0cff7fbd5d8c1dd0d2d204b2b` was previously described as a concurrent/parallel change. The user confirmed there is no other writer. It is therefore classified as **unaccounted self-drift during this execution**, not parallel work.
- The content was reviewed and retained because it matches the approved simpler branch-entry design, but future unknown commits must trigger `STOP_AND_RECONCILE` before any further write.
- Integration coverage now explicitly verifies authorization survives shift open/close.
- Pre-enforcement exact-head Full Verify #2666 is Green. A final exact-head Verify is required after the mutation-time guard group before Production.
- Fast Verify #333 applied the migration and schema successfully. The only integration failure was a test-ordering bug: the shift-independence assertion selected the most recent row by timestamp and could tie with an older revoked row. Backend `can_user_work` already returned true. The test now asserts exactly one active `approved` authorization instead of relying on timestamp ordering.

## Production gate

State: **BLOCKED**

- No Production migration has been applied.
- No Production work-authorization policy rows have been created.
- `VITE_WORK_AUTHORIZATION_GATE` remains disabled by default.
- No server enforcement is active in Production.
- No merge to `main` without exact-head Full Verify Green and explicit user approval.
- No Production migration or feature activation without explicit user approval.

## Next action

1. Keep the authorization model branch-scoped and shift-independent. ✅
2. Keep revoke -> pending behavior atomic. ✅
3. Keep Realtime wake-up with no polling. ✅
4. Run exact-head Fast Verify.
5. Run exact-head Full Verify including Fresh DB + integration/RLS + browser smoke.
6. Pre-enforcement Full Verify #2666 Green. ✅
7. Centralized mutation-time server guard added with transaction-local cache and explicit print/KDS/shift exclusions. ✅
8. Run exact-head Fast Verify + Full Verify for the final mutation-guard head.
9. If Green: **STOP BEFORE MERGE** and present final Production migration/activation gate. Do not merge, apply Production migration, or enable the feature flag.

## Mandatory update protocol

- Read this log before each write group.
- Record every code group and verification result here.
- Keep branch / PR / Production state current.
- If any change unexpectedly touches printing/KDS/send-to-kitchen, stop and record it.
- This file and `docs/CURRENT_WORK_PLAN.md` are the source of truth; conversation memory is not.
