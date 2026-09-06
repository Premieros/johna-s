# HANDOVER CHECKPOINT — 2026-09-06

> Read `docs/CURRENT_WORK_PLAN.md` first. This checkpoint records the newer live state when that file is stale.

## Fixed identity
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn` ONLY
- Production branch: `main`
- Permanent development branch: `development/final-handover`
- Never mix with `pos.v2` or Supabase `scpovyrqmsbiduanykod`.
- Never force-push `main` or development.

## Current main / Production baseline
- Verified Production baseline: `main@bb703cf4c6ad799d7395708f7255daaedb80cdad`.
- Merge commit for PR #42: `security: scope subscription status to accessible tenant`.
- PR #42 Verify #848 was Full Green: frontend + Fresh DB + Schema + Integration/Security/RLS + Browser Smoke.
- Merged-main Verify #849 was Full Green: frontend + Fresh DB + Schema + Integration/Security/RLS + Browser Smoke.
- Deploy #573 completed successfully: build ✅ / Production API parity ✅ / GitHub Pages deploy ✅.
- Production migration `subscription_tenant_scope` was applied successfully to `azzdesuowpdcoflmyezn`.
- Production Post-Check confirms `subscription_is_active(uuid)` and `user_can_access_organization(uuid)` are SECURITY DEFINER with `search_path = public, pg_temp`, authenticated-only EXECUTE, anon/PUBLIC denied, and tenant-scope protection present.
- `development/final-handover` was fast-forwarded to verified `main@bb703cf4c6ad799d7395708f7255daaedb80cdad` with `force=false` before this documentation commit.
- Remaining phase counter stays **6**. P0-B SECURITY DEFINER audit is not closed yet; Production still contains additional authenticated-executable SECURITY DEFINER functions using legacy `search_path = public` that require function-by-function review.

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
Targeted functions:
- `is_super_admin()`
- `admin_data_delete_section(uuid,text)`
- `admin_data_seed_all(uuid)`
- `verify_auth_account(uuid)`
- `repair_auth_account(uuid)`
- `toggle_organization_status(uuid,boolean)`

Final contract:
- all six use `search_path = public, pg_temp`.
- authenticated EXECUTE retained; anon/PUBLIC EXECUTE revoked.
- existing authorization contracts preserved.

Verification / release:
- PR Verify #840 Full Green ✅.
- merged `main@3182de0b83d09e1414512e75982e066518d72645`.
- Production migration `admin_security_definer_search_path` applied ✅.
- Production Post-Check passed ✅.
- main Verify #841 Full Green ✅.
- Deploy #570 Full Green ✅.

### PR #40 — Identity SECURITY DEFINER search-path hardening — CLOSED on Production ✅
Targeted functions:
- `login_as_user(uuid,text,text,text)`
- `password_matches(uuid,text)`

Final contract:
- both use `search_path = public, pg_temp`.
- authenticated EXECUTE retained; anon/PUBLIC EXECUTE revoked.
- `login_as_user` remains active-Super-Admin-only and blocks self/Super-Admin targets.
- `password_matches` retains the existing Super-Admin-equivalent `is_pos_admin()` guard.

Verification / release:
- PR Verify #842 Full Green ✅.
- merged `main@9d8a2c248140930de3a77d8b0b1f83bbcd1ee879`.
- Production migration `identity_security_definer_search_path` applied ✅.
- Production Post-Check passed ✅.
- main Verify #843 Full Green ✅.
- Deploy #571 Full Green ✅.

### PR #41 — Subscription admin SECURITY DEFINER search-path hardening — CLOSED on Production ✅
Confirmed deviation:
- authenticated-executable subscription admin mutation/settings functions retained legacy `search_path = public` while their Super Admin authorization guards were already correct.

Final contract:
- targeted subscription admin functions now use `search_path = public, pg_temp`.
- authenticated EXECUTE retained; anon/PUBLIC EXECUTE revoked.
- Super Admin guards and business behavior preserved.
- the only CI failure encountered was a test regex that expected unqualified `is_super_admin()`; the test was corrected to accept both `is_super_admin()` and `public.is_super_admin()` without weakening the guard requirement.

Verification / release:
- PR Verify #846 Full Green ✅.
- merged `main@56e822a133b1bd8885aafa1bab9b5ac67b99bf49`.
- Production migration applied successfully ✅.
- Production Post-Check passed ✅.
- main Verify #847 Full Green ✅.
- Deploy #572 Full Green ✅.

### PR #42 — Subscription tenant-scope oracle hardening — CLOSED on Production ✅
Confirmed defect:
- `subscription_is_active(uuid)` accepted an arbitrary tenant UUID from any authenticated caller and read organization/subscription state before proving access, allowing a cross-tenant subscription-status oracle.
- its scope helper `user_can_access_organization(uuid)` still used legacy `search_path = public`.

Final contract:
- authentication required.
- Super Admin is the only implicit cross-tenant bypass.
- `NULL` tenant inference for the caller's current tenant remains supported.
- explicit tenant probes require `user_can_access_organization(...)` before organization/subscription reads.
- inaccessible/foreign tenant probes return `false` without revealing existence or status.
- `subscription_is_active(uuid)` and `user_can_access_organization(uuid)` use `search_path = public, pg_temp`.
- authenticated EXECUTE retained; anon/PUBLIC revoked.

Regression coverage:
- `tests/integration/subscription_tenant_scope.test.ts` covers own tenant, NULL inference, foreign tenant non-oracle denial, Super Admin bypass, search path, and grants.

Verification / release:
- PR Verify #848 Full Green ✅.
- merged `main@bb703cf4c6ad799d7395708f7255daaedb80cdad`.
- Production migration `subscription_tenant_scope` applied ✅.
- Production Post-Check passed for both functions ✅.
- main Verify #849 Full Green ✅.
- Deploy #573: build + Production parity + Pages deploy ✅.

## Active next work — continue P0-B Function-by-Function
1. Continue the Production SECURITY DEFINER inventory; do not bulk-rewrite.
2. Prioritize functions that both use legacy `search_path = public` and read/write tenant/branch-sensitive data.
3. Inspect frontend/server callers and existing regressions before changing authorization behavior.
4. Separate pure constant/no-data helpers from functions that can create information or mutation oracles.
5. For every confirmed defect: narrow migration + explicit Regression + Full Verify before Production.
6. Preserve public API/error contracts unless a confirmed security regression requires a safer non-oracle response.
7. Full Verify → merge → Production migration/post-check → merged-main Verify + Deploy.
8. Do not reduce Remaining below **6** until the P0-B audit has no confirmed SECURITY DEFINER deviation left.

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
