# FINAL BUG REGISTER

> Source of truth for remaining confirmed deviations. Update after every verified fix batch.

## Fixed identity
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn` ONLY
- Production branch: `main`
- Development branch: `development/final-handover`
- Verified Production baseline: `main@80f5ed535e07cb3c839266e7e8d5dda5b3cd5f87` (PR #43)

## Counting rules
- Count only confirmed, unique deviations.
- Do not count a Supabase advisor warning as a defect when the SECURITY DEFINER exposure is intentional and guarded.
- Do not double-count the same root cause across stages.
- Runtime/UI items are counted only after reproduction.
- Every fix must preserve closed contracts and pass Regression -> Full Verify -> Merge -> Production Post-Check -> merged-main Verify/Deploy.

## Current confirmed unique deviations: 74

### Stage 6 — P0-B SECURITY DEFINER audit — 71 confirmed
Production inventory:
- authenticated-executable SECURITY DEFINER functions: 162 total.
- functions still using legacy/unhardened search_path rather than `public, pg_temp`: **71**.
- automated scan found **0** obvious role-label authorization checks for `owner`, `manager`, or `branch_manager` in the remaining SECURITY DEFINER set.

Classification of the 71:
- mutation/operational/identity functions: 50.
- read/helper-like functions: 21.

Important: 162 is not the bug count. Many authenticated SECURITY DEFINER RPCs are intentional. The tracked defect is the 71 legacy search-path contracts until each is reviewed and hardened or explicitly justified.

Known clusters inside the 71 include:
- subscription/payment helpers: `submit_instapay_payment`, `review_instapay_payment`, `subscription_expired`, `subscription_settings_get`, `super_admin_remove_branch_override`.
- printing: `set_print_status`.
- order/POS helpers: `create_order`, `update_order`, `detach_order`, `set_table_status` and related legacy-path RPCs.
- purchasing/inventory/accounting groups with the same legacy-path deviation.

Root-fix rule:
- prefer exact-signature `ALTER FUNCTION ... SET search_path TO public, pg_temp` when authorization/body behavior is already verified and the only deviation is search_path.
- never rewrite function bodies just to harden search_path.
- if auth/branch/tenant behavior is also wrong, isolate it into a dedicated Regression and narrow migration.
- no dynamic/broad migration that changes future/unreviewed functions.

### Stage 5 — P0-C Auth/password — 1 confirmed
- Supabase Security Advisor: `Leaked Password Protection Disabled`.
- Do not claim closed until enabled and Login/Create User/Password Update regressions pass, or an external platform limitation is documented.

### Stage 4 — Published Runtime/UI — 0 confirmed yet
- No static finding is counted as a runtime defect.
- Must run the published end-to-end cycle before closing: login/bootstrap, shifts, POS, KDS, payment, inventory, approvals, reports, RTL/LTR, desktop/mobile.

### Stage 3 — Printing — 1 confirmed but already included in Stage 6 count
- `set_print_status(uuid,text)` still uses legacy `search_path=public`.
- Do not add it again to the unique total.
- Functional printing behavior still requires Stage 3 runtime validation.

### Stage 2 — Release hardening — 1 confirmed
- `main` is currently not protected with required checks.
- This is release-governance drift, not an application runtime failure.

### Stage 1 — Cleanup/handover — 1 confirmed
- `docs/FINAL_REMAINING_STAGES.md` is stale and still references PR #41 as active.
- Must be synchronized to the current verified baseline and this bug register.

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

## Current execution order
1. Close Stage 6 root causes by reviewed clusters, preserving bodies where only search_path is wrong.
2. Re-run Production inventory after every batch and decrement the 71 count from actual Production state only.
3. When Stage 6 reaches zero confirmed deviations, move countdown 6 -> 5.
4. Continue stages 5 -> 1 with the same evidence gates.

## Mandatory safety rules
- Before every write, re-fetch development/main HEAD and review concurrent commits.
- No force push.
- No unverified Production DDL.
- Never weaken RLS/tests to make CI green.
- Super Admin is the only implicit bypass; other roles are labels only.
- Clean/organize only within the touched repair scope.
- Prefer root-cause fixes that eliminate several repeated symptoms, but never hide unrelated defects under one broad change.
