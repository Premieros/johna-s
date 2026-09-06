# HANDOVER CHECKPOINT — 2026-09-06

> Read `docs/CURRENT_WORK_PLAN.md` first. Newer live state and bug counts are in this checkpoint and `docs/FINAL_BUG_REGISTER.md`.

## Fixed identity
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn` ONLY
- Production branch: `main`
- Permanent development branch: `development/final-handover`
- Never mix with `pos.v2` or Supabase `scpovyrqmsbiduanykod`.
- Never force-push `main` or development.

## Current verified baseline
- Verified Production/Main: `bd4e7a81582db0799a01b20c2f5d63d38937d85e` — PR #44 merge.
- PR #44 Verify #854: Full Green ✅.
- Merged-main Verify #855: frontend + Fresh DB + Schema + Integration/Security/RLS + Browser Smoke Full Green ✅.
- Deploy #575: build + Production API parity + GitHub Pages Full Green ✅.
- Production migration `subscription_runtime_search_path` applied to `azzdesuowpdcoflmyezn` ✅.
- Production Post-Check measured legacy SECURITY DEFINER search-path deviations **71 -> 66** ✅.
- `development/final-handover` fast-forwarded to verified main with `force=false` before this documentation update.
- Remaining phase counter stays **6**. P0-B is still active.
- Current unique confirmed deviations: **69**; see `docs/FINAL_BUG_REGISTER.md`.

## Closed Production work — do not reopen without regression
- Batch 1 Users / Roles / Permission-First ✅
- PR #35 Warehouse transfer branch isolation ✅
- PR #36 Controlled branch delete ✅
- PR #37 Warehouse lifecycle + safe delete ✅
- PR #38 `close_shift` Permission-First ✅
- PR #39 Admin SECURITY DEFINER hardening ✅
- PR #40 Identity SECURITY DEFINER hardening ✅
- PR #41 Subscription admin SECURITY DEFINER hardening ✅
- PR #42 Subscription tenant-status oracle hardening ✅
- PR #43 Subscription branch-override tenant integrity ✅

### PR #44 — Subscription/payment runtime search-path root fix — CLOSED on Production ✅
Targeted reviewed functions:
- `submit_instapay_payment(uuid,text,numeric,text,text,text)`
- `review_instapay_payment(uuid,boolean,text)`
- `subscription_expired(uuid)`
- `subscription_settings_get()`
- `super_admin_remove_branch_override(uuid,text)`

Contract:
- exact-signature `ALTER FUNCTION ... SET search_path TO public, pg_temp` only.
- no function body rewrite.
- no authorization/grant/API/error-contract change.
- authenticated execution retained; anon denied.

Verification / release:
- PR Verify #854 Full Green ✅.
- merged `main@bd4e7a81582db0799a01b20c2f5d63d38937d85e`.
- Production migration `subscription_runtime_search_path` applied ✅.
- Production Post-Check: all 5 hardened; legacy count 71 -> 66 ✅.
- merged-main Verify #855 Full Green ✅.
- Deploy #575 build + Production parity + Pages ✅.

## Active next confirmed defect — `produce_inventory_unit(...)`
Production review confirmed a deeper issue than search_path:
- SECURITY DEFINER + authenticated executable.
- legacy `search_path=public`.
- no explicit authentication/active-user guard.
- no `production.manage` Permission-First guard.
- no canonical `user_may_access_branch(p_branch_id)` guard.
- no validation that `p_warehouse_id` is active and belongs to `p_branch_id`.
- function consumes raw/component inventory, writes batches/entries/production history, and updates unit/product costs.
- current repository code search found no direct frontend caller, but the RPC remains externally callable by authenticated users.

Target safe contract for the next isolated regression/fix:
1. Super Admin only implicit bypass.
2. non-Super-Admin requires `production.manage`.
3. canonical branch access required before any inventory mutation.
4. target warehouse must be active and belong to the target branch before mutation.
5. preserve existing unit validation, quantity rules, FIFO consumption, costing, entries, batches, and output behavior.
6. harden `search_path = public, pg_temp` and keep anon/PUBLIC denied.
7. denied paths must leave inventory/cost/history unchanged.

## P0-B execution rule
- Continue the remaining 66 legacy search-path functions in reviewed functional clusters, never a blind bulk rewrite.
- If search_path is the sole confirmed defect, prefer exact-signature ALTER FUNCTION and preserve bodies.
- If a function has a deeper auth/branch/tenant defect, isolate it into its own Regression and narrow migration.
- Recount from actual Production state after every verified rollout.
- Do not reduce Remaining below **6** until P0-B has no confirmed SECURITY DEFINER deviation left.

## Mandatory rules
- Work only on confirmed deviations; do not reopen closed batches without regression evidence.
- Super Admin is the only implicit bypass; all other role names are labels only.
- Permission-First + branch/RLS isolation.
- Never weaken RLS or tests to get CI green.
- SECURITY DEFINER review always includes auth, permission, branch/tenant scope, search_path, grants, and caller behavior.
- Never apply unverified branch DDL to Production.
- Before every write, re-fetch current branch HEAD and review new commits.
- No force push.
- Clean/organize only within the repair scope; no unrelated broad refactors.
- Final target: `Published Site = Verified Main = Production DB Contract = Zero Drift`.
