# FINAL BUG REGISTER

> Source of truth for remaining confirmed deviations. Update after every verified fix batch.

## Fixed identity
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn` ONLY
- Production branch: `main`
- Development branch: `development/final-handover`
- Verified Production baseline: `main@bd4e7a81582db0799a01b20c2f5d63d38937d85e` (PR #44)

## Counting rules
- Count only confirmed, unique deviations.
- Do not count a Supabase advisor warning as a defect when SECURITY DEFINER exposure is intentional and guarded.
- Do not double-count the same root cause across stages.
- Runtime/UI items are counted only after reproduction.
- Every fix must preserve closed contracts and pass Regression -> Full Verify -> Merge -> Production Post-Check -> merged-main Verify/Deploy.

## Current confirmed unique deviations: 69

### Stage 6 — P0-B SECURITY DEFINER audit — 67 confirmed
Production inventory after PR #44:
- authenticated-executable SECURITY DEFINER functions: 162 total; this is not the defect count.
- functions still using legacy/unhardened search_path rather than `public, pg_temp`: **66**.
- automated scan found **0** obvious role-label authorization checks for `owner`, `manager`, or `branch_manager` in the remaining SECURITY DEFINER set.
- separate deeper confirmed defect: **`produce_inventory_unit(...)` lacks auth/Permission-First/branch/warehouse scope guards** while mutating inventory and costs. This is counted once in addition to its legacy search-path item.

PR #44 root fix closed 5 legacy search-path deviations without rewriting bodies:
- `submit_instapay_payment`
- `review_instapay_payment`
- `subscription_expired`
- `subscription_settings_get`
- `super_admin_remove_branch_override`

Evidence:
- PR Verify #854 Full Green ✅.
- merged `main@bd4e7a81582db0799a01b20c2f5d63d38937d85e`.
- Production migration `subscription_runtime_search_path` applied ✅.
- Production Post-Check measured legacy count **71 -> 66** ✅.
- merged-main Verify #855 Full Green ✅.
- Deploy #575 build + Production parity + Pages ✅.

Remaining search-path clusters are reviewed in groups, but each function must still be validated before inclusion in a migration. Do not bulk-rewrite the 66.

#### Critical next defect — `produce_inventory_unit(...)`
Confirmed Production behavior:
- SECURITY DEFINER + authenticated-executable.
- legacy `search_path=public`.
- no explicit auth guard.
- no `can_permission('production.manage')` guard.
- no `user_may_access_branch(p_branch_id)` guard.
- no proof that `p_warehouse_id` belongs to `p_branch_id`.
- function consumes component/raw stock, writes batches/entries/production history, and updates costs.

Safest target contract:
- Super Admin remains sole implicit bypass.
- non-Super-Admin requires `production.manage`.
- require canonical branch access before any data mutation.
- require active warehouse belonging to the target branch before any mutation.
- preserve current quantity/recipe/FIFO/costing/output behavior.
- harden search path and grants without changing unrelated APIs.
- explicit regression for denied paths and no-mutation guarantees.

Root-fix rule:
- use exact-signature `ALTER FUNCTION ... SET search_path TO public, pg_temp` only when authorization/body behavior is already proven correct and search_path is the sole defect.
- when auth/branch/tenant behavior is wrong, use a dedicated Regression + narrow migration.
- no dynamic migration over unreviewed functions.

### Stage 5 — P0-C Auth/password — 1 confirmed
- Supabase Security Advisor: `Leaked Password Protection Disabled`.
- Do not claim closed until enabled and Login/Create User/Password Update regressions pass, or an external platform limitation is documented.

### Stage 4 — Published Runtime/UI — 0 confirmed yet
- No static finding is counted as a runtime defect.
- Must run the published end-to-end cycle before closing: login/bootstrap, shifts, POS, KDS, payment, inventory, approvals, reports, RTL/LTR, desktop/mobile.

### Stage 3 — Printing
- `set_print_status(uuid,text)` remains legacy `search_path=public`, already included in the Stage 6 count and not double-counted.
- Functional printing behavior still requires Stage 3 runtime validation.

### Stage 2 — Release hardening — 1 confirmed
- `main` is currently not protected with required checks.
- This is release-governance drift, not an application runtime failure.

### Stage 1 — Cleanup/handover — 0 confirmed documentation drift now
- Previous stale `FINAL_REMAINING_STAGES.md` drift was corrected in PR #44.
- Continue normal final cleanup only after functional/security stages close.

## Closed / protected contracts — do not regress
- Batch 1 Users/Roles/Permission-First.
- PR #35 Warehouse transfer isolation.
- PR #36 Controlled branch delete.
- PR #37 Warehouse lifecycle.
- PR #38 close_shift Permission-First.
- PR #39 Admin SECURITY DEFINER hardening.
- PR #40 Identity hardening.
- PR #41 Subscription admin hardening.
- PR #42 Subscription tenant-status oracle fix.
- PR #43 Subscription branch-override tenant integrity.
- PR #44 Subscription/payment runtime search-path hardening.

## Current execution order
1. Fix `produce_inventory_unit` as a dedicated security regression.
2. Continue Stage 6 by reviewed clusters, preserving bodies when search_path is the only defect.
3. Re-run Production inventory after every batch; decrement counts only from actual Production state.
4. When Stage 6 reaches zero confirmed deviations, move countdown `6 -> 5`.
5. Continue stages 5 -> 1 with the same evidence gates.

## Mandatory safety rules
- Before every write, re-fetch development/main HEAD and review concurrent commits.
- No force push.
- No unverified Production DDL.
- Never weaken RLS/tests to make CI green.
- Super Admin is the only implicit bypass; other roles are labels only.
- Clean/organize only within the touched repair scope.
- Prefer root-cause fixes that eliminate repeated symptoms, but never hide unrelated defects under one broad change.
