# HANDOVER CHECKPOINT — 2026-09-06

> Read `docs/CURRENT_WORK_PLAN.md` first. This checkpoint records the newer verified live state when that file is stale.

## Fixed identity
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn` ONLY
- Production branch: `main`
- Permanent development branch: `development/final-handover`
- Never mix with `pos.v2` or Supabase `scpovyrqmsbiduanykod`.
- Never force-push `main` or development.

## Current verified baseline
- Verified Production/Main: `80f5ed535e07cb3c839266e7e8d5dda5b3cd5f87` — PR #43 merge.
- PR #43 Verify #852: Full Green ✅.
- Merged-main Verify #853: frontend + Fresh DB + Schema + Integration/Security/RLS + Browser Smoke Full Green ✅.
- Deploy #574: build + Production API parity + GitHub Pages Full Green ✅.
- Production migration `subscription_branch_override_tenant_integrity` applied successfully to `azzdesuowpdcoflmyezn` ✅.
- Production Post-Check for `super_admin_set_branch_override(...)`: SECURITY DEFINER ✅, `search_path = public, pg_temp` ✅, authenticated-only EXECUTE ✅, Super Admin guard ✅, branch→tenant validation ✅, `BRANCH_TENANT_MISMATCH` guard ✅.
- `development/final-handover` fast-forwarded to verified main with `force=false` before this documentation commit.
- Remaining phase counter stays **6**. P0-B SECURITY DEFINER audit is still open.

## Closed Production work — do not reopen without regression

### Batch 1 — Users / Roles / Permission-First ✅
- roles are labels only; Super Admin is the sole implicit bypass.
- `create_user` uses `users.manage` + branch scope.
- User Creation Toggle enforced inside RPC.
- self-escalation and over-assignment guarded.
- password update/delete are permission + branch scoped and operational history is preserved.
- users SELECT RLS supports authorized same-branch management and prevents cross-branch visibility.

### PR #35 — Warehouse transfer branch isolation ✅
- canonical transfer permissions + branch scope.
- From/To warehouses and products must match transfer branch.
- inaccessible transfer uses non-oracle `TRANSFER_NOT_FOUND`.
- hardened `search_path = public, pg_temp`.

### PR #36 — Controlled Branch Delete ✅
- direct authenticated DELETE fail-closed.
- safe hard delete only for setup-only branch.
- operational/history branch returns `BRANCH_HAS_OPERATIONAL_HISTORY` + `DEACTIVATE_BRANCH`.
- no mass FK rewrite and no automatic auth-user delete.

### PR #37 — Warehouse lifecycle + safe delete ✅
- warehouse branch immutable.
- only truly unreferenced warehouse can hard-delete.
- dependency-bearing warehouse routes to deactivate.
- cross-branch delete/read non-oracle.
- transfer rejection auth/permission/branch scoped.

## P0-B SECURITY DEFINER audit — closed items

### Demo helpers ✅
- `seed_demo_data` / `delete_demo_data` service-role-only, hardened, no frontend caller found.

### PR #38 — `close_shift` Permission-First ✅
- removed role-label authorization.
- non-Super-Admin requires `shifts.close`; other-cashier close also requires `shifts.manage`.
- branch-scoped lookup + `SHIFT_NOT_FOUND` non-oracle.
- hardened search path/grants.

### PR #39 — Admin SECURITY DEFINER search-path hardening ✅
Hardened without changing existing authority:
- `is_super_admin()`
- `admin_data_delete_section(uuid,text)`
- `admin_data_seed_all(uuid)`
- `verify_auth_account(uuid)`
- `repair_auth_account(uuid)`
- `toggle_organization_status(uuid,boolean)`
Verify #840 / main #841 / Deploy #570 all green.

### PR #40 — Identity SECURITY DEFINER hardening ✅
- `login_as_user(uuid,text,text,text)`
- `password_matches(uuid,text)`
Search path/grants hardened; existing guards preserved.
Verify #842 / main #843 / Deploy #571 all green.

### PR #41 — Subscription admin SECURITY DEFINER hardening ✅
- targeted Super-Admin subscription admin/settings functions hardened to `public, pg_temp`.
- authenticated-only EXECUTE; existing Super Admin guards/business behavior preserved.
- test regex corrected to accept qualified or unqualified `is_super_admin()` without weakening the guard requirement.
Verify #846 / main #847 / Deploy #572 all green.

### PR #42 — Subscription tenant-scope oracle hardening ✅
Confirmed defect closed:
- `subscription_is_active(uuid)` previously accepted arbitrary tenant UUID and could reveal foreign subscription status.
Final contract:
- authentication required.
- Super Admin only cross-tenant bypass.
- NULL/current-tenant inference preserved.
- foreign/inaccessible tenant returns `false` without existence/status disclosure.
- `subscription_is_active(uuid)` and `user_can_access_organization(uuid)` hardened.
Regression: `tests/integration/subscription_tenant_scope.test.ts`.
Verify #848 / main #849 / Deploy #573 all green.

### PR #43 — Subscription branch override tenant integrity ✅
Confirmed defect closed:
- `super_admin_set_branch_override(...)` accepted `p_tenant_id` and `p_branch_id` independently.
- schema had separate FKs but no invariant proving the branch belonged to the supplied tenant.
- this could create an override/event attributed to the wrong tenant.
Final contract:
- existing Super Admin-only authority preserved.
- resolve `branches.organization_id` before any write.
- tenant/branch mismatch returns `BRANCH_TENANT_MISMATCH`.
- mismatch writes neither override nor event.
- matching tenant/branch preserves normal success behavior.
- function hardened to `search_path = public, pg_temp` and authenticated-only EXECUTE.
Regression: `tests/integration/subscription_branch_override_tenant_integrity.test.ts`.
CI notes:
- Verify #850 failed only because test fixture used invalid feature category `test`; changed fixture to valid `management`.
- Verify #851 failed only because `runAs` intentionally rolls back DML; success-path test switched to existing `runAsPersist`.
- migration itself was unchanged across these test-harness fixes.
Release:
- PR Verify #852 Full Green ✅.
- merged `main@80f5ed535e07cb3c839266e7e8d5dda5b3cd5f87`.
- Production migration `subscription_branch_override_tenant_integrity` applied ✅.
- Production Post-Check passed ✅.
- main Verify #853 Full Green ✅.
- Deploy #574 Full Green ✅.

## Active next work — continue P0-B function-by-function
1. Continue Production SECURITY DEFINER inventory; never bulk-rewrite.
2. Prioritize functions using legacy `search_path = public` that read/write branch or tenant sensitive data.
3. Inspect actual callers and existing regressions before changing authorization behavior.
4. Separate constant/no-data helpers from real information or mutation oracles.
5. Every confirmed defect requires: narrow migration + explicit Regression + Full Verify before Production.
6. Preserve public API/error contracts unless a confirmed security defect requires a safer non-oracle response.
7. Release sequence: Full Verify → merge → Production migration/post-check → merged-main Verify + Deploy → fast-forward dev with `force=false` → checkpoint update.
8. Do not reduce Remaining below **6** until P0-B has no confirmed SECURITY DEFINER deviation left.

## Mandatory rules
- Work only on confirmed deviations; do not reopen closed batches without regression evidence.
- Super Admin is the only implicit bypass; all other role names are labels only.
- Permission-First + branch/RLS isolation.
- Never weaken RLS or tests to get CI green.
- SECURITY DEFINER review always includes auth, permission, branch/tenant scope, search_path, grants, and caller behavior.
- Never apply unverified branch DDL to Production.
- Before every write, re-fetch current branch HEAD and review new commits.
- No force push.
- No unrelated broad refactors.
- Final target: `Published Site = Verified Main = Production DB Contract = Zero Drift`.
