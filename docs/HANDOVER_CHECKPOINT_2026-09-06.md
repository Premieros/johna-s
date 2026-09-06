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
- `main@5ba86ef67966d99e99d62a28717e2f87cf2c54a4`
- Merge commit for PR #37: `security: harden warehouse lifecycle and rejection scope`.
- Verify #834 on PR #37 head was Full Green: frontend + Fresh DB + Schema + Integration/Security/RLS + Browser Smoke.
- Verify #835 on merged `main` was Full Green: frontend + Fresh DB + Schema + Integration/Security/RLS + Browser Smoke.
- Deploy #568 completed successfully: build ✅ / Production API parity ✅ / GitHub Pages deploy ✅.
- Migration `warehouse_lifecycle_security` was applied successfully to Production `azzdesuowpdcoflmyezn`.
- Production post-check confirms:
  - `auth_delete_warehouses` is authenticated-only and calls `warehouse_delete_allowed(id, branch_id)`.
  - direct hard delete is allowed only with `warehouses.manage` + canonical branch access (or Super Admin implicit bypass) and only when the warehouse has zero FK references.
  - `delete_warehouse_safe(uuid)` is SECURITY DEFINER with `search_path = public, pg_temp`, authenticated-only EXECUTE, Permission-First authorization, branch-scoped non-oracle lookup, and dependency blockers returning `WAREHOUSE_HAS_OPERATIONAL_HISTORY` + `DEACTIVATE_WAREHOUSE`.
  - `reject_warehouse_transfer(uuid,text)` is SECURITY DEFINER with `search_path = public, pg_temp`, authenticated-only EXECUTE, `inventory.transfer.approve`, branch-scoped lookup, and inaccessible IDs return `TRANSFER_NOT_FOUND`.
  - `trg_guard_warehouse_branch_change` prevents changing `warehouses.branch_id` after creation.
- `development/final-handover` was fast-forwarded to verified `main@5ba86ef67966d99e99d62a28717e2f87cf2c54a4` with `force=false` before this documentation commit.

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

## Active next work — P0-B SECURITY DEFINER Remaining Audit
Follow `docs/CURRENT_WORK_PLAN.md` and close Function-by-Function only.

Start with:
1. `seed_demo_data` / `delete_demo_data`.
2. Prove current callers and intended capability before changing authorization.
3. Remove role-name authorization outside Super Admin implicit bypass.
4. Harden `search_path` to `public, pg_temp` where confirmed necessary.
5. Review auth, canonical permission, branch scope, grants, and caller behavior.
6. Add Regression for every confirmed defect.
7. Full Verify → merge → Production migration/post-check → Deploy/runtime verification.
8. Continue costing/detail/admin SECURITY DEFINER functions only after the first pair is closed.

## Mandatory rules
- Work only on confirmed deviations; do not reopen closed batches without regression evidence.
- Super Admin is the only implicit bypass. `owner`, `manager`, `branch_manager`, etc. are labels only.
- Permission-First + branch/RLS isolation.
- Never weaken RLS or tests to get CI green.
- SECURITY DEFINER requires explicit auth/permission/branch/search_path/grant review.
- Never apply unverified branch DDL to Production.
- Before every write, re-fetch current branch HEAD and review new commits.
- No force push.
- Update work log/checkpoint whenever a batch closes.
- Final target: `Published Site = Verified Main = Production DB Contract = Zero Drift`.
