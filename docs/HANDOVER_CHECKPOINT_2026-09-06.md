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
- `development/final-handover` was fast-forwarded to verified main with `force=false`; documentation and active Stage 4 commits then advanced development only.
- Remaining phase counter is **5** because Stage 6/P0-B is closed.
- Exact current root-cause count and active plan live in `docs/FINAL_BUG_REGISTER.md` and `docs/FINAL_REMAINING_STAGES.md`.

## Closed Production work — do not reopen without regression
- Batch 1 Users / Roles / Permission-First ✅
- PR #30 Shared Branch Shift ✅
- PR #31 POS Discount / Payment / Order Completion ✅
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

## Stage 5 — Auth/password
One confirmed account-level deviation remains:
- Supabase `Leaked Password Protection` is disabled.
- It is an Auth project setting and may require plan/account capability.
- The currently connected Supabase toolset exposes database/migration operations but no Auth configuration write action; do not claim this closed until the actual project setting is changed and revalidated.

## Active Stage 4 — Published Runtime/UI

### Stage 4.1 — Shift Cash Integrity + Branch Scope — ACTIVE via PR #47
Current PR:
- PR #47: `security: harden shift cash integrity and branch scope`.
- Base remains verified `main@8b671fca36d60a200e743a2192581d83c3fa1f6e`.
- Active development branch: `development/final-handover`.

Confirmed target defects:
- direct authenticated DML on `shift_operations` outside trusted RPCs;
- inconsistent expected-cash equations across shift read/close paths;
- non-canonical branch scoping in selected shift-control paths.

Do not merge/apply Production until current PR HEAD has Full Verify Green.

### Stage 4.2 — POS Operator Ownership & Table Transfer — APPROVED / QUEUED
This operating contract is now official and must be implemented immediately after Stage 4.1 closes, before the rest of the published POS runtime cycle is accepted.

Approved contract:
- one shared open shift per branch; opener remains audit metadata, not exclusive shift owner;
- any active user with `shifts.open` and branch access may open/reuse the branch shift;
- POS access and actions remain fine-grained Permission-First;
- each new order belongs operationally to the authenticated operator and ordinary callers cannot spoof `cashier_id`;
- owner may work their own order/table subject to each action permission;
- another user in the same branch can see occupied table + responsible user name but cannot modify/pay/cancel/move that order;
- Dine-in table ownership derives from its active open/held order unless a future independent table-owner requirement is proven;
- transferring an order/table to another operator requires a dedicated transfer permission, never role-name authorization;
- source user, target user, order and table must be within canonical same-branch scope;
- transfer must be audited with old owner/new owner/actor/time;
- Server-Side enforcement is mandatory across RPC/RLS/direct-write boundaries; UI hiding is supplemental only;
- Super Admin remains the only implicit bypass.

Confirmed current gap behind this batch:
- `create_order(...)` accepts an optional `p_cashier_id` without an explicit delegation contract;
- `update_order(...)` currently enforces branch scope but not owner-or-transfer-authority;
- table/order transfer paths are not yet consistently owner + permission scoped;
- branch-scoped write RLS on `orders`/`dining_tables` must be reviewed so direct writes cannot bypass ownership.

Required regression matrix is documented in `docs/FINAL_REMAINING_STAGES.md` and `docs/FINAL_BUG_REGISTER.md`.

### Stage 4.3 — Remaining operating cycle
After 4.1 and 4.2: login/bootstrap, all POS order types, send-to-kitchen once/delta, KDS, inventory effects, cash/card, discounts/voids/returns, hold/split/merge/transfer, shift close/day close/offline path, reports, guided routing, RTL/LTR, desktop/mobile.

## Stage 3 — Printing
`set_print_status(uuid,text)` search-path drift is already CLOSED by PR #46. Functional printing still needs runtime validation.

## Stage 2 — Release hardening
One confirmed repository-level deviation remains:
- `main` currently reports `protected=false` with required checks disabled.
- Current connected GitHub toolset can read this state but may not expose a branch-protection/ruleset write action; do not claim closed until repository settings are actually changed and re-read as protected.

## Stage 1 — Cleanup/handover
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
