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
- `main@3939c48f301abf1d0c826aa825155e9920bb7c4a`
- Merge commit for PR #35: `security: enforce warehouse transfer branch isolation`.
- Verify #826 on PR head was Full Green: frontend + Fresh DB + Schema + Integration/Security/RLS + Browser Smoke.
- Verify #827 on merged `main` was Full Green: frontend + Fresh DB + Schema + Integration/Security/RLS + Browser Smoke.
- Deploy #566 completed successfully with Production parity ✅.
- Migration `warehouse_transfer_branch_scope` was applied successfully to Production `azzdesuowpdcoflmyezn` and is present in Production migration history.
- Production post-check confirms both warehouse-transfer SECURITY DEFINER RPCs use `search_path = public, pg_temp`, require auth + canonical transfer permissions, enforce branch-scoped warehouses/products, and use non-oracle `TRANSFER_NOT_FOUND` for inaccessible approvals.
- `development/final-handover` was fast-forwarded to verified `main` with `force=false` before this documentation commit.

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

Closed defect:
- `create_warehouse_transfer(...)` and `approve_warehouse_transfer(...)` previously allowed incomplete branch integrity checks and approval lookup could expose cross-branch transfer existence/status.

Final contract:
- auth required.
- canonical transfer permissions required.
- `user_may_access_branch(...)` enforced.
- From/To warehouses tied to the same transfer branch.
- products tied to the same transfer branch.
- approval scopes transfer lookup by accessible branch.
- inaccessible transfer returns `TRANSFER_NOT_FOUND`, not `BRANCH_MISMATCH`, to avoid an existence/status oracle.
- warehouse/product integrity revalidated before inventory movement.
- `search_path = public, pg_temp`.
- stock-count denial contract remains `BRANCH_MISMATCH` and was not changed.

Regression coverage:
- `tests/integration/warehouse_transfer_branch_scope.test.ts`.
- `tests/integration/v2_operational_approval_security.test.ts` aligned only for the inaccessible warehouse-transfer assertion.

## Active next defect — Controlled Branch Delete 🔴

Confirmed read-only risk:
- direct branch hard-delete remains dangerous because many child foreign keys use `ON DELETE CASCADE` across operational/history tables.
- current DELETE access being limited to Super Admin is not sufficient protection against accidental loss of operational history.

Required controlled contract:
1. Empty/setup-only branch may be hard-deleted only after explicit dependency checks.
2. Branch with operational/history dependencies must reject hard delete with a clear error and direct the caller to `deactivate_branch`.
3. `deactivate_branch` is the normal operational removal path and must preserve all history.
4. Do not globally rewrite dozens of foreign keys without evidence.
5. Add regressions for:
   - empty branch delete succeeds;
   - branch with operational history rejects hard delete;
   - deactivate branch succeeds and preserves history.
6. After branch delete is closed, audit warehouse create/edit/deactivate/delete and stock/history dependency behavior with the same safe-delete principle.

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
