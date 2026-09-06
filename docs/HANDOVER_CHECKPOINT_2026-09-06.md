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
- `main@c7ef63a8550ea3c070a20faa8bdb78c76000c268`
- Merge commit for PR #36: `security: make branch hard delete dependency-safe`.
- Verify #828 on PR #36 head was Full Green: frontend + Fresh DB + Schema + Integration/Security/RLS + Browser Smoke.
- Verify #829 on merged `main` was Full Green: frontend + Fresh DB + Schema + Integration/Security/RLS + Browser Smoke.
- Deploy #567 completed successfully with Production parity and GitHub Pages deploy ✅.
- Migration `controlled_branch_delete` was applied successfully to Production `azzdesuowpdcoflmyezn` and is present in Production migration history.
- Production post-check confirms `auth_delete_branches` is fail-closed (`USING(false)`) and `delete_branch_cascade` is SECURITY DEFINER with `search_path = public, pg_temp`, authenticated-only execute, `branches.manage`, branch scope, current-branch protection, and operational-history blockers.
- `development/final-handover` was fast-forwarded to verified `main@c7ef63a8550ea3c070a20faa8bdb78c76000c268` with `force=false` before this documentation commit.

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

## Active next work — Warehouse lifecycle + safe delete
Audit and close only confirmed deviations for:
1. create warehouse.
2. edit warehouse.
3. deactivate / re-enable warehouse.
4. delete empty warehouse.
5. warehouse with stock must not hard-delete operational state.
6. warehouse with inventory history must not hard-delete history.
7. warehouse referenced by transfers, purchases, counts, waste, or other operational records must fail safely or require explicit operational handling.
8. cross-branch warehouse read/write attempts.
9. direct RPC attacks and SECURITY DEFINER review: auth, permission, branch scope, search_path, grants, caller behavior.
10. refresh/persistence after lifecycle actions.
11. add Regression for every confirmed defect, then Full Verify → merge → Production migration/post-check → deploy/runtime verify.

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
