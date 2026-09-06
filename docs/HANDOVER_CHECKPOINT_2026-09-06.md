# HANDOVER CHECKPOINT — 2026-09-06

> Read `docs/CURRENT_WORK_PLAN.md` first. This checkpoint records the newer live state after that file became stale.

## Fixed identity
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn` ONLY
- Production branch: `main`
- Permanent development branch: `development/final-handover`
- Never mix with `pos.v2` or Supabase `scpovyrqmsbiduanykod`.
- Never force-push `main`.

## Current main / Production baseline
- `main@d661ceeb853374709727c285da0c43944a6503a7`
- This is merge commit for PR #34: `security: enforce permission-first user management`.
- Verify #822 was Full Green: frontend + Fresh DB + Schema + Integration/Security/RLS + Browser Smoke.
- PR #34 migrations were applied successfully to Production `azzdesuowpdcoflmyezn` and post-checked.

### Batch 1 — Users / Roles / Permission-First — CLOSED on Production ✅
Closed items:
- `create_user` uses `users.manage` + branch scope; no `branch_manager` role-name authorization.
- User Creation Toggle is enforced inside RPC, not UI-only.
- `guard_user_role_changes` is Permission-First; users cannot self-escalate role/branch/status.
- Manager cannot assign a role containing permissions the manager does not own.
- `update_user_password` is scoped through `users.manage` and branch access.
- `delete_user` protects operational/audit history; users with dependencies must be disabled instead of hard-deleted.
- Auth technical rows are cleaned in safe order for users that are genuinely deletable.
- `users` SELECT RLS recognizes `users.manage` for same-branch management visibility while preserving cross-branch isolation.
- Hardened `search_path = public, pg_temp` on targeted helpers.

## Active work — Batch 2: Branches + Warehouses + Cross-Branch Isolation
Open PR:
- PR #35: `security: enforce warehouse transfer branch isolation`
- Base: `main@d661ceeb853374709727c285da0c43944a6503a7`
- Current recorded head before this documentation commit: `0076fe3b846e420f8ac651e1e770a13df58aba35`
- PR is OPEN, mergeable, not merged.
- NO Production DDL from PR #35 has been applied.

### Confirmed defect addressed by PR #35
`create_warehouse_transfer` / `approve_warehouse_transfer` are SECURITY DEFINER boundaries. Before the patch:
- warehouse/product ownership was not fully tied to the transfer branch;
- approval could inspect/act before a canonical branch-scope guard;
- both used `search_path=public` only.

Patch adds:
- authentication + canonical transfer permissions;
- `user_may_access_branch(p_branch_id)`;
- both warehouses must belong to the same branch;
- every transferred product must belong to the transfer branch;
- approval scopes the transfer lookup itself to an accessible branch (non-oracle behavior);
- warehouse/product branch integrity is revalidated before inventory movement;
- `search_path = public, pg_temp`.

Regression added:
- `tests/integration/warehouse_transfer_branch_scope.test.ts`
- attacks Branch B from a Branch A user using forged branch id, foreign warehouses, foreign product, and cross-branch approval.

## Verify #824 — IMPORTANT CURRENT FAILURE
Workflow run: #824 / run id `34045180347` for head `0076fe3b846e420f8ac651e1e770a13df58aba35`.

Results:
- Frontend gate ✅
- Fresh DB ✅
- Schema ✅
- Integration/Security/RLS: 524 passed / 1 failed
- Browser Smoke did not become the final green gate because Integration failed.

The single failure is an OLD assertion in:
`tests/integration/v2_operational_approval_security.test.ts`

Test:
`allows warehouse-transfer approval in the secondary authorized branch only`

Allowed secondary branch path already PASSES.
The inaccessible branch path expected:
`{ success:false, error:'BRANCH_MISMATCH' }`

New hardened RPC intentionally returns:
`{ success:false, error:'TRANSFER_NOT_FOUND' }`

Reason: approval now scopes the lookup itself through `user_may_access_branch`, so an inaccessible transfer is intentionally indistinguishable from a nonexistent transfer. This removes a cross-branch existence/status oracle. The assertion is stale relative to the stronger security contract.

### Exact next action
1. Re-fetch current `development/final-handover` HEAD before writing; another model may be active.
2. Re-read the full current `tests/integration/v2_operational_approval_security.test.ts` before editing.
3. Change ONLY the stale warehouse-transfer inaccessible-branch assertion from `BRANCH_MISMATCH` to `TRANSFER_NOT_FOUND` if HEAD still contains the same PR #35 behavior.
4. Do NOT weaken the RPC to restore `BRANCH_MISMATCH`.
5. Push that narrow test correction to `development/final-handover`.
6. Wait for Full Verify. Required green gates: frontend + Fresh DB/schema + Integration/Security/RLS + Browser Smoke.
7. Only after Full Green: review PR #35 final diff/head, merge to `main`, fetch exact merged migration, apply only that migration to Production `azzdesuowpdcoflmyezn`, and run Production read-only post-check.
8. Fast-forward `development/final-handover` to verified main with `force=false` if needed.

## Next Batch 2 defect already discovered read-only — do not mix into PR #35 before it closes
Direct hard-delete of a branch is high-risk because many child FKs use `ON DELETE CASCADE` across operational/history tables. Current branch DELETE policy is restricted to Super Admin, but a hard delete could still erase broad operational history.

After PR #35 is fully closed, inspect and implement a controlled branch-delete contract:
- empty/setup-only branch may be deletable under explicit safe checks;
- branch with operational/history dependencies must refuse hard delete and direct user to deactivate instead;
- `deactivate_branch` remains the normal operational removal path;
- do not globally rewrite dozens of FKs without evidence.

Also inspect warehouse delete/deactivate behavior and dependencies similarly.

## Mandatory rules
- Source of truth starts with `docs/CURRENT_WORK_PLAN.md`, then this newer checkpoint.
- Work only on confirmed deviations; do not reopen closed batches without regression evidence.
- Super Admin is the only implicit bypass. Owner/manager/etc are labels only.
- Permission-First + branch/RLS isolation.
- Never weaken RLS/tests to get CI green.
- SECURITY DEFINER requires explicit caller/permission/branch review and hardened search_path.
- Never apply unverified branch DDL to Production.
- Do not touch `main` until the focused PR is Full Green.
- Update work log/checkpoint whenever a batch actually closes.
- Final target remains: `Published Site = Verified Main = Production DB Contract = Zero Drift`.
