# FINAL BUG REGISTER

> Source of truth for remaining confirmed deviations. Update after every verified fix batch.

## Fixed identity
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn` ONLY
- Production branch: `main`
- Development branch: `development/final-handover`
- Verified Production baseline: `main@8b671fca36d60a200e743a2192581d83c3fa1f6e` (PR #46)

## Counting rules
- Count only confirmed, unique deviations.
- Do not count an intentional and guarded SECURITY DEFINER exposure as a defect.
- Do not double-count the same root cause across stages.
- Runtime/UI items are counted only after reproduction.
- Every code/database fix must preserve closed contracts and pass Regression -> Full Verify -> Merge -> Production Post-Check -> merged-main Verify/Deploy.

## Current confirmed unique deviations: 2

### Stage 6 — P0-B SECURITY DEFINER audit — CLOSED ✅
Production authenticated-executable public SECURITY DEFINER legacy search-path count is now **0**.

#### PR #45 — `produce_inventory_unit(...)` security boundary — CLOSED on Production ✅
Closed the deeper auth/Permission-First/branch/warehouse defect while preserving FIFO, costing, batches, entries, production history, and the explicit trusted `service_role` backend contract.

Evidence:
- PR Verify #861 / run `34082101236`: Full Green ✅.
- merged `main@3f0d777202a3329e9af85fead0c3828647ed9e47`.
- Production migration `produce_inventory_unit_security` applied ✅.
- Production comparable legacy search-path count **66 -> 65** ✅.
- merged-main Verify #862 / run `34082401371`: Full Green ✅.
- Deploy #576 / run `34082401376`: build + Production parity + Pages Full Green ✅.

#### PR #46 — remaining SECURITY DEFINER search paths — CLOSED on Production ✅
Safe accelerated closure:
- generated the remaining 65 exact signatures from current Production inventory;
- changed only function `search_path` to `public, pg_temp`;
- no body rewrite, grant change, API change, return-type change, permission change, branch/tenant change, FIFO/costing change, or error-contract change;
- added a permanent Fresh-DB regression requiring zero Production SECURITY DEFINER legacy search paths;
- CI-only `ci_%` helpers are excluded from that Production invariant because the workflow creates them only after canonical migrations and they never exist on real Supabase.

Evidence:
- PR #46 head `85233da9036434750b4adc36436e99341ec3641c`.
- PR Verify #864 / run `34086924649`: frontend + Fresh DB + Schema + **564 Integration/Security/RLS tests** + Browser Smoke Full Green ✅.
- merged `main@8b671fca36d60a200e743a2192581d83c3fa1f6e`.
- Production migration `security_definer_search_path_zero` applied to `azzdesuowpdcoflmyezn` ✅.
- Production Post-Check measured comparable count **65 -> 0** ✅.
- Production migration ledger contains `security_definer_search_path_zero` ✅.
- merged-main Verify #865 / run `34087225163`: Full Green ✅.
- Deploy #577 / run `34087225208`: build + Production API parity + Pages Full Green ✅.
- `development/final-handover` fast-forwarded to the verified merge with `force=false` before documentation updates ✅.

Stage counter may now advance **6 -> 5**.

### Stage 5 — P0-C Auth/password — 1 confirmed
- Supabase Auth `Leaked Password Protection` remains disabled.
- Supabase documentation confirms the feature is configured at Auth settings and is available on Pro Plan and above.
- Current connected Supabase toolset does not expose an Auth configuration write action, so this cannot be truthfully marked fixed from the current connector.
- Close only after the account-level setting is enabled and login/create-user/password-update behavior is revalidated, or an external platform limitation is documented.

### Stage 4 — Published Runtime/UI — 0 confirmed yet
- No static finding is counted as a runtime defect.
- Required published end-to-end cycle remains: login/bootstrap, shifts, POS, KDS, payment, inventory, approvals, reports, RTL/LTR, desktop/mobile.

### Stage 3 — Printing
- `set_print_status(uuid,text)` search_path defect is CLOSED by PR #46 and must not be double-counted.
- Functional printing behavior still requires Stage 3 runtime validation.

### Stage 2 — Release hardening — 1 confirmed
- `main` remains unprotected (`protected=false`) with no required checks.
- This is release-governance drift, not an application runtime failure.
- Current connected GitHub toolset can read protection/rulesets but does not expose a branch-protection/ruleset write action; do not claim closed until account/repository settings are actually changed and re-read as protected.

### Stage 1 — Cleanup/handover — 0 confirmed documentation drift
- Continue scoped cleanup only; no unrelated broad refactors.

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
- PR #46 SECURITY DEFINER search-path zero closure.

## Current execution order
1. Stage 5: enable/verify leaked-password protection if an account-level write path is available.
2. Stage 4: execute the published full operating cycle and count only reproduced deviations.
3. Stage 3: validate printing end-to-end now that its search_path drift is closed.
4. Stage 2: enforce required protection/checks on `main` when repository-admin write capability is available.
5. Stage 1: final cleanup/handover and zero-drift proof.

## Mandatory safety rules
- Before every write, re-fetch development/main HEAD and review concurrent commits.
- No force push.
- No unverified Production DDL.
- Never weaken RLS/tests to make CI green.
- Super Admin is the only implicit application bypass; business role names are labels only.
- Trusted `service_role` backend contracts must be explicit and never exposed in frontend code.
- Clean/organize only within the touched repair scope.
- Final target: `Published Site = Verified Main = Production DB Contract = Zero Drift`.
