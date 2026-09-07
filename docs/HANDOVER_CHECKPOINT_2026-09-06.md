# HANDOVER CHECKPOINT — 2026-09-06

> Read `docs/CURRENT_WORK_PLAN.md` first. Newer live state and exact remaining deviations are recorded here and in `docs/FINAL_BUG_REGISTER.md`.

## Fixed identity
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn` ONLY
- Production branch: `main`
- Permanent development branch: `development/final-handover`
- Never mix with `pos.v2` or Supabase `scpovyrqmsbiduanykod`.
- Never force-push `main` or development.

## Current verified baseline
- Verified Production/Main: `8b671fca36d60a200e743a2192581d83c3fa1f6e` — PR #46 merge.
- PR #46 Verify #864 / run `34086924649`: frontend + Fresh DB + Schema + 564 Integration/Security/RLS tests + Browser Smoke Full Green ✅.
- Merged-main Verify #865 / run `34087225163`: Full Green ✅.
- Deploy #577 / run `34087225208`: build + Production API parity + GitHub Pages Full Green ✅.
- Production migration `security_definer_search_path_zero` applied to `azzdesuowpdcoflmyezn` ✅.
- Production Post-Check measured authenticated-executable public SECURITY DEFINER legacy search-path deviations **65 -> 0** ✅.
- Production migration ledger contains `security_definer_search_path_zero` ✅.
- `development/final-handover` was fast-forwarded to verified main with `force=false`; documentation commits then advanced development only.
- Remaining phase counter advances **6 -> 5** because P0-B is closed.
- Current confirmed unique deviations: **2**; see `docs/FINAL_BUG_REGISTER.md`.

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
- PR #44 Subscription/payment runtime search-path hardening ✅
- PR #45 `produce_inventory_unit(...)` Permission-First/branch/warehouse hardening ✅
- PR #46 remaining authenticated SECURITY DEFINER search-path closure ✅

### PR #45 — `produce_inventory_unit(...)` — CLOSED on Production ✅
- active-user + `production.manage` + canonical branch access added for authenticated callers.
- active warehouse must belong to target branch before mutation.
- explicit trusted `service_role` backend contract preserved.
- FIFO, costing, batches, entries, production history and API behavior preserved.
- `search_path=public, pg_temp`; anon denied.
- comparable legacy count **66 -> 65**.
- PR Verify #861 ✅; main Verify #862 ✅; Deploy #576 ✅.

### PR #46 — SECURITY DEFINER search-path zero — CLOSED on Production ✅
Accelerated safe closure used one reviewed exact-signature migration for all 65 remaining confirmed search-path deviations:
- only `ALTER FUNCTION <exact-signature> SET search_path TO public, pg_temp`;
- no body rewrite;
- no grant/API/return/error/permission/branch/tenant/business-logic change;
- Fresh-DB invariant permanently requires zero Production-like authenticated-executable public SECURITY DEFINER legacy search paths;
- CI-only `ci_%` helpers are excluded because the workflow creates them only for CI and they do not exist on real Supabase.

Release evidence:
- PR #46 head `85233da9036434750b4adc36436e99341ec3641c`.
- PR Verify #864 Full Green ✅.
- merged `main@8b671fca36d60a200e743a2192581d83c3fa1f6e`.
- Production migration `security_definer_search_path_zero` applied ✅.
- Production Post-Check **65 -> 0** ✅.
- main Verify #865 Full Green ✅.
- Deploy #577 build + Production parity + Pages Full Green ✅.

## Active Stage 5 — Auth/password
One confirmed account-level deviation remains:
- Supabase `Leaked Password Protection` is disabled.
- Supabase documentation confirms it is an Auth project setting and requires Pro Plan or above.
- The currently connected Supabase toolset exposes database/migration operations but no Auth configuration write action; do not claim this closed until the actual project setting is changed and revalidated.

## Later stages
### Stage 4 — Published Runtime/UI
Run a real published end-to-end operating cycle: login/bootstrap, shifts, POS, KDS, payment, inventory, approvals, reports, RTL/LTR, desktop/mobile. Count only reproduced failures.

### Stage 3 — Printing
`set_print_status(uuid,text)` search-path drift is already CLOSED by PR #46. Functional printing still needs runtime validation.

### Stage 2 — Release hardening
One confirmed repository-level deviation remains:
- `main` currently reports `protected=false` with required checks disabled.
- Current connected GitHub toolset can read this state but does not expose a branch-protection/ruleset write action; do not claim closed until repository settings are actually changed and re-read as protected.

### Stage 1 — Cleanup/handover
Final scoped cleanup and zero-drift proof only after functional stages are validated.

## Mandatory rules
- Before every write, re-fetch current `main` and development HEADs and review parallel commits.
- No force push.
- No unverified Production DDL.
- Never weaken RLS/tests to make CI green.
- Super Admin is the only implicit application bypass; all other business role names are labels only.
- Permission-First + canonical branch/RLS isolation.
- SECURITY DEFINER review includes auth, permission, branch/tenant scope, search_path, grants and caller behavior.
- Trusted `service_role` backend contracts must stay explicit and frontend-inaccessible.
- Clean/organize only within the touched repair scope; no unrelated broad refactors.
- Final target: `Published Site = Verified Main = Production DB Contract = Zero Drift`.
