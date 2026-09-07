# FINAL BUG REGISTER

> Source of truth for remaining confirmed deviations. Update after every verified fix batch.

## Fixed identity
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn` ONLY
- Production branch: `main`
- Development branch: `development/final-handover`
- Verified Production baseline: `main@3f0d777202a3329e9af85fead0c3828647ed9e47` (PR #45)

## Counting rules
- Count only confirmed, unique deviations.
- Do not count a Supabase advisor warning as a defect when SECURITY DEFINER exposure is intentional and guarded.
- Do not double-count the same root cause across stages.
- Runtime/UI items are counted only after reproduction.
- Every fix must preserve closed contracts and pass Regression -> Full Verify -> Merge -> Production Post-Check -> merged-main Verify/Deploy.

## Current confirmed unique deviations: 67

### Stage 6 — P0-B SECURITY DEFINER audit — 65 confirmed
Production inventory after PR #45:
- authenticated-executable SECURITY DEFINER functions are inventory context only; total count is not the defect count.
- functions still using legacy/unhardened search_path rather than `public, pg_temp`: **65**.
- automated scan previously found **0** obvious role-label authorization checks for `owner`, `manager`, or `branch_manager` in the remaining SECURITY DEFINER set.
- the separate deep `produce_inventory_unit(...)` authorization/scope defect is now CLOSED on Production and no longer counted.

PR #44 root fix closed 5 legacy search-path deviations without rewriting bodies:
- `submit_instapay_payment`
- `review_instapay_payment`
- `subscription_expired`
- `subscription_settings_get`
- `super_admin_remove_branch_override`

Evidence for PR #44:
- PR Verify #854 Full Green ✅.
- merged `main@bd4e7a81582db0799a01b20c2f5d63d38937d85e`.
- Production migration `subscription_runtime_search_path` applied ✅.
- Production Post-Check measured legacy count **71 -> 66** ✅.
- merged-main Verify #855 Full Green ✅.
- Deploy #575 build + Production parity + Pages ✅.

### PR #45 — `produce_inventory_unit(...)` security boundary — CLOSED on Production ✅
Closed defects:
- missing active-user guard for authenticated callers.
- missing `production.manage` Permission-First guard.
- missing canonical `user_may_access_branch(p_branch_id)` scope guard.
- missing active warehouse -> target branch integrity check.
- legacy `search_path=public`.

Preserved contracts:
- existing manufactured-unit validation, FIFO component/raw consumption, costing, batches, entries, production history, and unit/product cost updates remain unchanged.
- documented trusted `service_role` backend execution remains available.
- authenticated application callers remain Permission-First and branch-scoped.
- `anon`/PUBLIC execution remains denied.
- no literal business-role authorization and no redundant `is_pos_admin()` guard.

Evidence:
- PR #45 head `55fa1f9b64dfeb74e2584e87392add58d40af210`.
- PR Verify #861 / run `34082101236`: frontend + Fresh DB + Schema + Integration/Security/RLS + Browser Smoke Full Green ✅.
- merged `main@3f0d777202a3329e9af85fead0c3828647ed9e47`.
- Production migration `produce_inventory_unit_security` applied to `azzdesuowpdcoflmyezn` ✅.
- Production Post-Check: SECURITY DEFINER, `search_path=public, pg_temp`, authenticated/service_role execute true, anon execute false, Permission/branch/warehouse guards present ✅.
- comparable Production legacy authenticated SECURITY DEFINER search-path count **66 -> 65** ✅.
- merged-main Verify #862 / run `34082401371`: Full Green ✅.
- Deploy #576 / run `34082401376`: build + Production parity + Pages Full Green ✅.
- `development/final-handover` fast-forwarded to verified main with `force=false` before this documentation update ✅.

Remaining search-path functions must still be reviewed in functional clusters; do not bulk-rewrite the 65.

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
- PR #45 Inventory unit production Permission-First/branch/warehouse hardening.

## Current execution order
1. Continue Stage 6 by reviewed functional clusters, preserving bodies when search_path is the only defect.
2. Escalate any deeper auth/branch/tenant defect into its own regression rather than hiding it inside a search-path batch.
3. Re-run Production inventory after every batch; decrement counts only from actual comparable Production state.
4. When Stage 6 reaches zero confirmed deviations, move countdown `6 -> 5`.
5. Continue stages 5 -> 1 with the same evidence gates.

## Mandatory safety rules
- Before every write, re-fetch development/main HEAD and review concurrent commits.
- No force push.
- No unverified Production DDL.
- Never weaken RLS/tests to make CI green.
- Super Admin is the only implicit application bypass; other business role names are labels only.
- Trusted `service_role` backend contracts must be explicit and never exposed in frontend code.
- Clean/organize only within the touched repair scope.
- Prefer root-cause fixes that eliminate repeated symptoms, but never hide unrelated defects under one broad change.
