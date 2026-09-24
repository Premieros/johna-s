# WORK AUTHORIZATION UI-FIRST — LIVE WORK LOG — 2026-09-24

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/work-authorization-ui-20260924`
Current PR: `#355`
Last updated: 2026-09-24 14:58 Africa/Cairo

## Work status

State: **PRE-MIGRATION FULL GREEN / PRODUCTION BLOCKED**

- Current phase: final centralized entry-gate + revoke-to-pending + realtime verification (feature flag off; not activated).
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
- **No role-name authorization:** `owner`, `branch_manager`, `cashier`, etc. are labels only. UI visibility/actions use `useCan()` / canonical permissions plus branch scope. Only `super_admin` may be treated as the existing implicit bypass.
- During UI-first preview, reuse existing canonical permissions instead of inventing frontend-only permissions: `approvals.review` controls review surfaces and `approvals.policy.manage` controls policy/settings surfaces. Dedicated `work.authorization.*` permissions are deferred to the backend-contract phase so frontend and DB never drift.

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
6. PR #340 is merged and defines the current permissions UX direction: non-Super-Admins only see/grant permissions they own with their full dependency closure; higher capabilities are hidden rather than exposed disabled; backend still rejects privilege escalation.
7. Work Authorization UI must follow the same pattern: never branch on `branch_manager`/`owner`; use canonical permissions and accessible-branch scope.

## Change ledger

### 2026-09-24 — restart on fresh main

- Created `development/work-authorization-ui-20260924` from `main@189973bb04e6ea81e766d2cea568ccbe7ab6c8da`.
- Confirmed old work branch had diverged by 240 main commits and will not be used for implementation.
- Confirmed approval center and canonical permission files on current main before writes.
- Reviewed merged PR #340 and `PERMISSIONS_UI_SIMPLIFICATION_PLAN_2026-09-23.md`; adopted its Permission-First visibility/grant rules.
- Reviewed `PR19_PERMISSION_FIRST_CLOSURE_LOG.md` and `EXECUTION_GUARDRAILS.md`; confirmed all non-Super-Admin roles are labels only and branch/RLS scope remains mandatory.
- Declared this new mandatory active work log.
- Opened Draft PR #355 for staged UI-first implementation.
- Implemented typed client contract: `workAuthorizationContract.ts` (no Supabase access).
- Implemented in-memory preview provider: `mockWorkAuthorizationProvider.ts` (no Production writes).
- Implemented `WorkAuthorizationPreview.tsx` with Pending / Working now / History / Settings and employee waiting-screen preview.
- Mounted preview inside existing `ApprovalCenterPage`; live operational approval queue/RPCs remain intact.
- Permission gates: `approvals.review` for review surface; `approvals.policy.manage` for settings. No role-name guards.
- Added regression contract test ensuring no role-name authorization and no Supabase work-authorization writes.
- Extended client contract with employee-facing `getMyState(branchId)` and `requestAuthorization(branchId)` methods.
- Updated the mock provider to support the employee request/state lifecycle without Production access.
- Added `supabaseWorkAuthorizationProvider.ts` as an RPC-only production adapter; it is intentionally **not mounted** until verified backend RPCs exist.
- Added tests that fail if the production provider reads/writes tables directly or is mounted prematurely.
- Locked backend design in `docs/WORK_AUTHORIZATION_BACKEND_CONTRACT_2026-09-24.md` after read-only inspection of Production schema/RPC/RLS patterns.
- Added canonical permissions to the frontend permission catalog only: `work.authorization.approve`, `work.authorization.manage`, `work.authorization.bypass`.
- Added dependency/risk contracts: manage -> approve, bypass -> approve; manage/bypass critical, approve sensitive.
- Added unit coverage for work-authorization permission dependency closure.
- No role template was used to authorize the feature; no runtime role-name gate was added.
- Renamed preview display metadata from `roleLabel` to `positionLabel`; position/title is informational only and never used for authorization.
- Planned UI deliverables:
  - manager center tabs: Pending / Working now / History / Settings;
  - mobile-first cards and desktop responsive layout;
  - employee waiting-state preview;
  - typed client contract;
  - mock provider only;
  - explicit preview marker;
  - zero Production data writes.

## Verification ledger

- Latest-main check: PASS — `main@189973bb04e6ea81e766d2cea568ccbe7ab6c8da` (rechecked before backend contract preparation).
- Parallel-work check: PASS for this scope; open PR #352 is print-agent-only and remains out of scope.
- Old branch drift check: FAIL for reuse (240 commits behind main), therefore superseded safely.
- Static UI contract test added: `tests/unit/workAuthorizationUiFirstContract.test.ts`.
- Verify main run #2587 / `35996733090`: **FAILED AT MANDATORY WORKLOG GATE ONLY**. Cause: `activeWorklogGateContract.test.ts` still hard-coded the previous Performance log path; lint/type/unit/build were skipped.
- Fixed the stale hard-coded expected path to `docs/WORK_AUTHORIZATION_UI_FIRST_2026-09-24.md` without weakening any structural/branch/Production-gate assertions.
- Verify main run #2593 / `35996733090`: **FULL GREEN** on head `24ba942786115bba1dcc8f95c9cb204ecf646b9c`.
  - mandatory worklog gate ✅
  - locked Supabase identity ✅
  - frontend API contract ✅
  - lint ✅
  - app typecheck ✅
  - app + test-suite typecheck ✅
  - unit ✅
  - build ✅
  - fresh DB + schema ✅
  - integration/security/RLS ✅
  - browser smoke ✅
- Full Verify for the UI-first scope: **GREEN**.
- Verify main run #2604 / `36001815036`: **FULL GREEN** on pre-migration head `bea008e611c804ea425e933a5905f09c371b84ac`.
  - mandatory worklog gate ✅
  - locked Supabase identity ✅
  - frontend API contract ✅
  - lint ✅
  - app typecheck ✅
  - app + test-suite typecheck ✅
  - unit including work-authorization permission dependency tests ✅
  - build ✅
  - fresh DB + canonical migrations ✅
  - schema verify ✅
  - integration/security/RLS regression ✅
  - browser smoke ✅
- Pre-migration preparation state: **FULL GREEN**.
- Verify #2612 failed before DB execution at lint only: `work_authorization_backend.test.ts` used two explicit `any` types. No SQL/Fresh DB step ran in that attempt.
- Fixed the test types to `pg.QueryResultRow` / typed RPC value without weakening lint or tests.
- Fast Verify #322 exposed two final-stage issues: UI contract test had unnecessary escaped quotes, and the Realtime migration block had been stored with an invalid bare `DO $ ... END $;` delimiter. No Production impact.
- Fixed the test regex without weakening assertions and changed the Realtime block to the named dollar-quote delimiter `$realtime$ ... $realtime# WORK AUTHORIZATION UI-FIRST — LIVE WORK LOG — 2026-09-24

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/work-authorization-ui-20260924`
Current PR: `#355`
Last updated: 2026-09-24 14:58 Africa/Cairo

## Work status

State: **PRE-MIGRATION FULL GREEN / PRODUCTION BLOCKED**

- Current phase: final centralized entry-gate + revoke-to-pending + realtime verification (feature flag off; not activated).
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
- **No role-name authorization:** `owner`, `branch_manager`, `cashier`, etc. are labels only. UI visibility/actions use `useCan()` / canonical permissions plus branch scope. Only `super_admin` may be treated as the existing implicit bypass.
- During UI-first preview, reuse existing canonical permissions instead of inventing frontend-only permissions: `approvals.review` controls review surfaces and `approvals.policy.manage` controls policy/settings surfaces. Dedicated `work.authorization.*` permissions are deferred to the backend-contract phase so frontend and DB never drift.

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
6. PR #340 is merged and defines the current permissions UX direction: non-Super-Admins only see/grant permissions they own with their full dependency closure; higher capabilities are hidden rather than exposed disabled; backend still rejects privilege escalation.
7. Work Authorization UI must follow the same pattern: never branch on `branch_manager`/`owner`; use canonical permissions and accessible-branch scope.

## Change ledger

### 2026-09-24 — restart on fresh main

- Created `development/work-authorization-ui-20260924` from `main@189973bb04e6ea81e766d2cea568ccbe7ab6c8da`.
- Confirmed old work branch had diverged by 240 main commits and will not be used for implementation.
- Confirmed approval center and canonical permission files on current main before writes.
- Reviewed merged PR #340 and `PERMISSIONS_UI_SIMPLIFICATION_PLAN_2026-09-23.md`; adopted its Permission-First visibility/grant rules.
- Reviewed `PR19_PERMISSION_FIRST_CLOSURE_LOG.md` and `EXECUTION_GUARDRAILS.md`; confirmed all non-Super-Admin roles are labels only and branch/RLS scope remains mandatory.
- Declared this new mandatory active work log.
- Opened Draft PR #355 for staged UI-first implementation.
- Implemented typed client contract: `workAuthorizationContract.ts` (no Supabase access).
- Implemented in-memory preview provider: `mockWorkAuthorizationProvider.ts` (no Production writes).
- Implemented `WorkAuthorizationPreview.tsx` with Pending / Working now / History / Settings and employee waiting-screen preview.
- Mounted preview inside existing `ApprovalCenterPage`; live operational approval queue/RPCs remain intact.
- Permission gates: `approvals.review` for review surface; `approvals.policy.manage` for settings. No role-name guards.
- Added regression contract test ensuring no role-name authorization and no Supabase work-authorization writes.
- Extended client contract with employee-facing `getMyState(branchId)` and `requestAuthorization(branchId)` methods.
- Updated the mock provider to support the employee request/state lifecycle without Production access.
- Added `supabaseWorkAuthorizationProvider.ts` as an RPC-only production adapter; it is intentionally **not mounted** until verified backend RPCs exist.
- Added tests that fail if the production provider reads/writes tables directly or is mounted prematurely.
- Locked backend design in `docs/WORK_AUTHORIZATION_BACKEND_CONTRACT_2026-09-24.md` after read-only inspection of Production schema/RPC/RLS patterns.
- Added canonical permissions to the frontend permission catalog only: `work.authorization.approve`, `work.authorization.manage`, `work.authorization.bypass`.
- Added dependency/risk contracts: manage -> approve, bypass -> approve; manage/bypass critical, approve sensitive.
- Added unit coverage for work-authorization permission dependency closure.
- No role template was used to authorize the feature; no runtime role-name gate was added.
- Renamed preview display metadata from `roleLabel` to `positionLabel`; position/title is informational only and never used for authorization.
- Planned UI deliverables:
  - manager center tabs: Pending / Working now / History / Settings;
  - mobile-first cards and desktop responsive layout;
  - employee waiting-state preview;
  - typed client contract;
  - mock provider only;
  - explicit preview marker;
  - zero Production data writes.

## Verification ledger

- Latest-main check: PASS — `main@189973bb04e6ea81e766d2cea568ccbe7ab6c8da` (rechecked before backend contract preparation).
- Parallel-work check: PASS for this scope; open PR #352 is print-agent-only and remains out of scope.
- Old branch drift check: FAIL for reuse (240 commits behind main), therefore superseded safely.
- Static UI contract test added: `tests/unit/workAuthorizationUiFirstContract.test.ts`.
- Verify main run #2587 / `35996733090`: **FAILED AT MANDATORY WORKLOG GATE ONLY**. Cause: `activeWorklogGateContract.test.ts` still hard-coded the previous Performance log path; lint/type/unit/build were skipped.
- Fixed the stale hard-coded expected path to `docs/WORK_AUTHORIZATION_UI_FIRST_2026-09-24.md` without weakening any structural/branch/Production-gate assertions.
- Verify main run #2593 / `35996733090`: **FULL GREEN** on head `24ba942786115bba1dcc8f95c9cb204ecf646b9c`.
  - mandatory worklog gate ✅
  - locked Supabase identity ✅
  - frontend API contract ✅
  - lint ✅
  - app typecheck ✅
  - app + test-suite typecheck ✅
  - unit ✅
  - build ✅
  - fresh DB + schema ✅
  - integration/security/RLS ✅
  - browser smoke ✅
- Full Verify for the UI-first scope: **GREEN**.
- Verify main run #2604 / `36001815036`: **FULL GREEN** on pre-migration head `bea008e611c804ea425e933a5905f09c371b84ac`.
  - mandatory worklog gate ✅
  - locked Supabase identity ✅
  - frontend API contract ✅
  - lint ✅
  - app typecheck ✅
  - app + test-suite typecheck ✅
  - unit including work-authorization permission dependency tests ✅
  - build ✅
  - fresh DB + canonical migrations ✅
  - schema verify ✅
  - integration/security/RLS regression ✅
  - browser smoke ✅
- Pre-migration preparation state: **FULL GREEN**.
.

## Production gate

State: **BLOCKED**

- Pre-migration code/contract verification is Full Green on run #2604.
- No Production migration has been applied. Branch-only migration `20260924164500_work_authorization_backend.sql` now exists on the development branch only; Fresh DB + security verification is mandatory before any merge/apply.
- No work-authorization server enforcement is active.
- The centralized employee gate is mounted around `AppRoutes` behind `VITE_WORK_AUTHORIZATION_GATE=1`; the flag is off by default, so current Production behavior is unchanged.
- No merge to `main` until UI tests/verify are green and user reviews the staged interface.
- No Production activation until backend authority, RLS, RPC coverage, exact-head Full Verify Green, and explicit user approval.

## Next action

1. Add the typed work-authorization client contract and mock provider with **zero role checks**.
2. Build the manager UI preview with four tabs.
3. Build the employee waiting-screen preview.
4. Integrate preview mode into the existing Approval Center without changing live approval behavior. ✅
5. Add UI contract tests. ✅
6. Verify main #2593 is Green. ✅
7. Browser smoke is Green, but it does not exercise the new Approval Center preview directly; no false claim of a visual review is made.
8. Backend contract preparation has started **without activation**: Production schema/RPCs were inspected read-only, client RPC adapter is staged but unmounted.
9. Backend contract document is locked. ✅
10. Canonical frontend permissions + dependency tests added. ✅
11. Supabase CLI generation attempt could not complete in the local environment. ✅ Recorded.
12. Verify #2604 is Full Green for the pre-migration head. ✅
13. Approved fallback for branch-only implementation: create one forward-only migration file in repository with a monotonic 2026-09-24 timestamp later than existing migrations, then let Fresh DB CI be the authority that validates ordering/application. This fallback does **not** apply anything to Production.
14. Branch-only migration `20260924164500_work_authorization_backend.sql` implemented with capability-based permission seeding, tables, indexes, RLS, RPCs, audit, and shift bind/expire hooks. ✅
15. Dedicated integration test `tests/integration/work_authorization_backend.test.ts` added for fail-open rollout, branch scope, self-approval denial, direct-write denial, shift binding/expiry, and audit. ✅
16. Policy contract corrected to `userId + branchId + required` so first-time policy creation does not depend on a pre-existing policy row. ✅
17. User approved the simpler architecture: `Login -> Work Authorization Gate -> Application`. ✅
18. Added `WorkAuthorizationGate.tsx` as a centralized gate component. It checks once on mount/branch change, does not poll, has no role-name guards, and keeps the authenticated session mounted while waiting. ✅
19. Backend contract updated: approval/revocation changes will use Realtime to trigger a single lightweight state refresh; no page/button-level polling. ✅
20. Added a unit contract that fails if the gate introduces polling, role-name authorization, direct Supabase access, or loses the centralized gate marker. ✅
21. Centralized gate mounted around `AppRoutes` behind a default-off feature flag; `CloudPrintAgent` remains outside the gate. ✅
22. Approval Center now uses the real RPC provider only when the feature flag is enabled and the user owns `work.authorization.approve`; settings require `work.authorization.manage`. ✅
23. Final stop behavior locked: stopping an approved user atomically writes `revoked` and creates/reuses a new `pending` request for the same user+branch+shift. The worker therefore returns immediately to the waiting gate and cannot re-enter until a fresh approval. ✅
24. Realtime wake-up added for `work_authorizations` and `work_authorization_policies`; the gate performs one RPC refresh per change and never polls. ✅
25. Approval Center active/pending queues include active user accounts only. ✅
26. Added integration coverage for `approved -> revoke -> pending -> blocked -> reapprove -> allowed`, plus unit coverage for the app-level boundary, default-off feature flag, no polling, and print-agent isolation. ✅
27. Kept only `CloudPrintAgent` outside the authorization boundary; route-scoped UI extras remain blocked with the application. ✅
28. Added `bound_to_shift` to the typed/history UI contract so shift-binding events render correctly. ✅
29. Documented `VITE_WORK_AUTHORIZATION_GATE=0` in `.env.example`; the gate remains disabled by default until backend migration + explicit activation approval. ✅
30. Next: exact-head Verify/Fresh DB on this final architecture. Production apply and feature activation remain BLOCKED.

## Mandatory update protocol

- Before every write group: read this log and latest `main`/branch state.
- After every code group: append exact changed files and behavior to `Change ledger`.
- After every test/workflow: record the exact result in `Verification ledger`.
- Before PR/merge: update `Current PR`, branch head, drift status, and `Production gate`.
- If any scope touches printing/KDS/send-to-kitchen unexpectedly, stop that change and record it here.
- This file and `docs/CURRENT_WORK_PLAN.md` are the source of truth; conversation memory is not.
