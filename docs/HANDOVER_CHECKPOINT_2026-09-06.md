# HANDOVER CHECKPOINT — 2026-09-06

> Read `docs/CURRENT_WORK_PLAN.md` first. This checkpoint records the newer live state when that file is stale.

## Fixed identity
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn` ONLY
- Production branch: `main`
- Permanent development branch: `development/final-handover`
- Never mix with `pos.v2` or Supabase `scpovyrqmsbiduanykod`.
- Never force-push `main`.

## Current main / Production baseline
- `main@3182de0b83d09e1414512e75982e066518d72645`
- Merge commit for PR #39: `security: harden admin security definer search paths`.
- Verify #840 on PR #39 head was Full Green: frontend + Fresh DB + Schema + Integration/Security/RLS + Browser Smoke.
- Verify #841 on merged `main` was Full Green: frontend + Fresh DB + Schema + Integration/Security/RLS + Browser Smoke.
- Deploy #570 completed successfully: build ✅ / Production API parity ✅ / GitHub Pages deploy ✅.
- Migration `admin_security_definer_search_path` was applied successfully to Production `azzdesuowpdcoflmyezn`.
- Production post-check confirms the six targeted admin/security functions use `search_path = public, pg_temp`, authenticated-only EXECUTE, anon denied, and their existing authorization guards are unchanged.
- `development/final-handover` was fast-forwarded to verified `main@3182de0b83d09e1414512e75982e066518d72645` with `force=false` before this documentation commit.

### Batch 1 — Users / Roles / Permission-First — CLOSED on Production ✅
Do not reopen without a new Regression.

Closed contract includes:
- `create_user` uses `users.manage` + branch scope; no role-label authorization.
- User Creation Toggle enforced inside RPC.
- `guard_user_role_changes` prevents self-escalation and over-assignment of permissions.
- `update_user_password` is `users.manage` + branch scoped.
- `delete_user` preserves operational/audit history and requires disable instead of hard delete when dependencies exist.
- `users` SELECT RLS allows same-branch management visibility through `users.manage` while preserving cross-branch isolation.
- Super Admin only has implicit full bypass; all other roles are labels.

## Batch 2 — Branches + Warehouses + Cross-Branch Isolation

### PR #35 — Warehouse transfer branch isolation — CLOSED on Production ✅
Final contract:
- auth required.
- canonical transfer permissions required.
- `user_may_access_branch(...)` enforced.
- From/To warehouses tied to the same transfer branch.
- products tied to the same transfer branch.
- approval scopes transfer lookup by accessible branch.
- inaccessible transfer returns `TRANSFER_NOT_FOUND` to avoid a cross-branch existence/status oracle.
- warehouse/product integrity revalidated before inventory movement.
- `search_path = public, pg_temp`.
- stock-count denial contract remains `BRANCH_MISMATCH`.

Regression coverage:
- `tests/integration/warehouse_transfer_branch_scope.test.ts`.
- `tests/integration/v2_operational_approval_security.test.ts` aligned only for the inaccessible warehouse-transfer assertion.

### PR #36 — Controlled Branch Delete — CLOSED on Production ✅
Confirmed old risk:
- branch hard-delete could cascade across operational/history data and the old RPC explicitly removed accounting/auth rows.

Final contract:
- direct authenticated `DELETE` on `branches` is fail-closed.
- permanent deletion routes through controlled `delete_branch_cascade(...)`.
- authorization is Permission-First via `branches.manage`; Super Admin is the only implicit bypass.
- branch/current-branch guards remain enforced.
- setup-only unused branch may be deleted.
- branch with operational/history dependencies returns `BRANCH_HAS_OPERATIONAL_HISTORY` + `DEACTIVATE_BRANCH` and is not mutated.
- `deactivate_branch` remains the normal operational removal path and preserves history.
- no mass FK rewrite was introduced.
- no automatic auth-user deletion remains in the safe-delete path.

Regression coverage:
- `tests/integration/branch_hard_delete.test.ts` verifies direct-delete closure, Permission-First custom-role authorization, current-branch protection, empty branch delete, history rejection, deactivate success, and history persistence.

### PR #37 — Warehouse lifecycle + safe delete — CLOSED on Production ✅
Confirmed defects closed:
- `reject_warehouse_transfer` had incomplete auth/branch hardening and could expose transfer existence/status cross-branch.
- warehouse hard delete could erase referenced operational/history data through FK cascades.
- `warehouses.branch_id` could be changed after creation.

Final contract:
- warehouse create/edit/disable/re-enable remains Permission-First and branch scoped.
- warehouse `branch_id` is immutable after creation.
- authorized, completely unreferenced warehouse may be hard-deleted and recreated.
- any warehouse referenced by stock, transfers, purchases, counts, waste, or any other FK dependency is not hard-deleted.
- `delete_warehouse_safe` provides explicit dependency blockers and directs operational removal to `DEACTIVATE_WAREHOUSE`.
- cross-branch warehouse reads/deletes are non-oracle and denied.
- transfer rejection is auth + permission + branch scoped and uses `TRANSFER_NOT_FOUND` for inaccessible IDs.
- stock/history survives deactivate/re-enable.

Regression coverage:
- `tests/integration/warehouse_lifecycle_security.test.ts`.
- `tests/integration/warehouse_transfer_branch_scope.test.ts`.
- existing RLS branch-isolation suite remains intact and green.

## P0-B SECURITY DEFINER Remaining Audit

### Demo helpers — CLOSED / no change required ✅
Production inspection confirmed:
- `seed_demo_data` and `delete_demo_data` are already service-role-only.
- both are hardened with `search_path = public, pg_temp`.
- no frontend caller was found in the current project path.
- no code or Production migration was needed for this item.

### PR #38 — `close_shift` Permission-First hardening — CLOSED on Production ✅
Confirmed defects closed:
- old `close_shift` used the literal `branch_manager` role label to authorize closing another cashier's shift.
- function used `search_path = public` only.
- shift lookup happened by raw ID before canonical branch scope.

Final contract:
- unauthenticated/inactive users are denied.
- any non-Super-Admin close requires `shifts.close`.
- closing another cashier's shift additionally requires `shifts.manage`.
- role labels grant no authority; Super Admin remains the only implicit bypass.
- shift lookup is branch scoped through `user_may_access_branch` and inaccessible IDs return `SHIFT_NOT_FOUND`.
- `search_path = public, pg_temp`.
- EXECUTE is authenticated-only; anon/PUBLIC revoked.
- existing public denial contract `SHIFT_CLOSE_DENIED` is preserved.

Regression coverage:
- `tests/integration/close_shift_permission_first.test.ts`.
- existing shift Permission-First tests remain green.

### PR #39 — Admin SECURITY DEFINER search-path hardening — CLOSED on Production ✅
Confirmed deviation:
- six high-risk authenticated-executable admin/security functions still used `search_path = public` only while their authorization contracts were already correct.

Targeted functions:
- `is_super_admin()`
- `admin_data_delete_section(uuid,text)`
- `admin_data_seed_all(uuid)`
- `verify_auth_account(uuid)`
- `repair_auth_account(uuid)`
- `toggle_organization_status(uuid,boolean)`

Final contract:
- all six now use `search_path = public, pg_temp`.
- authenticated EXECUTE retained; anon/PUBLIC EXECUTE revoked.
- function bodies and business behavior were not rewritten.
- `admin_data_delete_section` and `admin_data_seed_all` retain `is_super_admin()` guards.
- `verify_auth_account` and `repair_auth_account` retain `is_pos_admin()` guards.
- `toggle_organization_status` retains `is_platform_admin()`.
- `is_super_admin()` retains the explicit active `super_admin` caller check.

Regression coverage:
- `tests/integration/admin_security_definer_search_path.test.ts` asserts exact signatures, hardened search path, grants, and preservation of existing guards.

Verification / release:
- PR Verify #840 Full Green ✅.
- merged `main@3182de0b83d09e1414512e75982e066518d72645`.
- Production migration `admin_security_definer_search_path` applied ✅.
- Production Post-Check passed for all six functions ✅.
- main Verify #841 Full Green ✅.
- Deploy #570: build + Production parity + Pages deploy ✅.

## Active next work — continue P0-B Function-by-Function
1. Re-extract Production SECURITY DEFINER functions executable by `authenticated`.
2. Prioritize destructive/high-privilege functions with missing auth/branch guards, role-label authorization, raw-ID lookup before canonical scope, or legacy `search_path = public`.
3. Inspect callers and existing tests before changing authorization.
4. Apply narrow fixes only; clean and organize touched code/tests while preserving API contracts.
5. Add Regression for every confirmed defect.
6. Full Verify → merge → Production migration/post-check → Deploy/runtime verification.
7. Continue until no confirmed P0-B SECURITY DEFINER deviation remains.

## Mandatory rules
- Work only on confirmed deviations; do not reopen closed batches without regression evidence.
- Super Admin is the only implicit bypass. `owner`, `manager`, `branch_manager`, etc. are labels only.
- Permission-First + branch/RLS isolation.
- Never weaken RLS or tests to get CI green.
- SECURITY DEFINER requires explicit auth/permission/branch/search_path/grant review.
- Never apply unverified branch DDL to Production.
- Before every write, re-fetch current branch HEAD and review new commits.
- No force push.
- Clean, organize, and remove local duplication while fixing the confirmed scope; do not perform unrelated broad refactors.
- Update work log/checkpoint whenever a batch closes.
- Final target: `Published Site = Verified Main = Production DB Contract = Zero Drift`.
