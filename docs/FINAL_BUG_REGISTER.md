# FINAL BUG REGISTER

> Source of truth for remaining confirmed deviations. Update after every verified fix batch and when a newly confirmed root-cause is admitted into the final-stage plan.

## Fixed identity
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn` ONLY
- Production branch: `main`
- Development branch: `development/final-handover`
- Verified Production baseline: `main@952c9954cbbebf760c44d75706ec569aac28a7bb` (PR #47)

## Counting rules
- Count only confirmed, unique root-cause deviations.
- Do not count one intentional and guarded exposure as a defect.
- Do not double-count symptoms that share one root cause.
- Runtime/UI items are counted only after reproduction or direct contract verification.
- Every code/database fix must preserve closed contracts and pass Regression -> Full Verify -> Merge -> Production Post-Check -> merged-main Verify/Deploy.

## Current confirmed unique deviations: 3 + Stage 4.2 awaiting Production closure

### Stage 6 — P0-B SECURITY DEFINER audit — CLOSED ✅
Production authenticated-executable public SECURITY DEFINER legacy search-path count is **0**.
Do not reopen without a new regression.

Evidence:
- PR #46 Verify #864 Full Green ✅.
- merged `main@8b671fca36d60a200e743a2192581d83c3fa1f6e` ✅.
- Production migration `security_definer_search_path_zero` applied ✅.
- merged-main Verify #865 ✅.
- Deploy #577 ✅.

### Stage 5 — P0-C Auth/password — 1 confirmed
**AUTH-001 — Leaked Password Protection disabled**
- Supabase Auth `Leaked Password Protection` remains disabled.
- Current connected Supabase toolset does not expose the Auth setting write action.
- Close only after the setting is enabled on the real project and login/create-user/password-update/reset behavior is revalidated, or the external platform limitation is explicitly documented.

### Stage 4 — Published Runtime/UI

#### RUNTIME-001 — Shift cash-integrity / scope drift — CLOSED ✅
Closed on Production by PR #47.

Fixed:
- authenticated direct DML on `shift_operations` no longer bypasses trusted cash-operation RPCs;
- expected-cash equations are aligned across get/close/force-close paths;
- branch checks use canonical authorization and do not expose cross-branch mismatch state;
- shared branch shift and Permission-First contracts are preserved.

Evidence:
- pre-merge Verify #875 Full Green ✅.
- merged `main@952c9954cbbebf760c44d75706ec569aac28a7bb` ✅.
- Production migration `shift_cash_integrity_and_scope` applied ✅.
- Production post-check ✅.
- merged-main Verify #876 Full Green ✅.
- Deploy #578 ✅.

#### RUNTIME-002 — POS operator ownership not centrally enforced — PRE-MERGE FIX VERIFIED ✅ / PRODUCTION CLOSURE PENDING
This remains one root cause; it is not split into separate symptoms.

Approved operating contract:
1. Shift is shared per branch.
2. POS access remains permission-driven.
3. New orders belong to `auth.uid()`; ordinary callers cannot spoof another cashier.
4. Only operational owner may normally edit/continue/pay/cancel/move an open/held order, subject to the exact action permission.
5. Dine-in table operational ownership derives from its active order.
6. Same-branch peers may see occupied state + narrow owner display label but cannot work the order/table.
7. Operator transfer requires `pos.order.transfer`, never a role-name check.
8. Source/target/order/table must remain same-branch authorized.
9. Transfer records old owner, new owner, actor and timestamp.
10. Server-side enforcement is mandatory; direct-DML/RPC fallback bypasses fail closed.
11. Super Admin remains the only implicit bypass.

Verified fixes in PR #48:
- order creation ownership pinned to authenticated operator;
- owner enforcement added to open-order mutation/status/payment/KDS/item-transfer paths;
- dedicated audited `transfer_order_operator` with same-branch fail-closed checks;
- direct floor-plan order/table mutation fallbacks removed so RPC remains authoritative;
- occupied tables expose narrow operator label without granting operation rights;
- kitchen send/delta ownership guard added;
- shared-shift sale attribution fixed for operators that also own `shifts.manage`, without duplicate sale shift-operations;
- deterministic attribution regressions added;
- Browser Smoke mock updated for `get_pos_order_operator_labels` rather than weakening runtime/tests.

Pre-merge evidence:
- PR #48 head `bfc50500c1db23eefbc67967a402101555d51e1d` passed Verify #885 / run `34155863941` Full Green ✅.
- Frontend/API/lint/typecheck/unit/build ✅.
- Fresh DB migrations + schema ✅.
- Integration + Security/RLS ✅.
- Browser Smoke / Playwright ✅.

Required remaining closure:
`Merge -> Production Stage 4.2 migrations/parity -> Production post-check -> merged-main Verify + Browser Smoke -> Deploy`.

Do not mark RUNTIME-002 fully CLOSED until that chain is complete.

### Stage 3 — Printing
- `set_print_status(uuid,text)` search-path defect is already CLOSED by PR #46 and must not be double-counted.
- Functional printing still requires Stage 3 runtime validation; count only defects reproduced there.

### Stage 2 — Release hardening — 1 confirmed
**RELEASE-001 — main branch is not protected**
- `main` reports `protected=false` and no required checks are enforced at branch level.
- This is release-governance drift, not an application runtime failure.
- Close only after repository settings are changed and re-read as protected, or a hard connector/admin limitation is documented without claiming closure.

### Stage 1 — Cleanup/handover
- No extra defect count assigned merely because final cleanup remains.
- Continue scoped cleanup only; no unrelated broad refactors.

## Closed / protected contracts — do not regress
- Batch 1 Users/Roles/Permission-First.
- PR #30 Shared Branch Shift.
- PR #31 POS discount/payment/order completion controls.
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
- PR #47 Shift cash integrity + branch scope.

## Current execution order
1. Stage 4.2: close PR #48 through merge, Production parity/post-check, merged-main Verify and Deploy.
2. Stage 4.3: continue the published full operating cycle and count only reproduced deviations.
3. Stage 5 Auth/password remains externally blocked on the project Auth setting unless a valid write path becomes available; do not falsely close it.
4. Stage 3: validate printing end-to-end.
5. Stage 2: enforce required protection/checks on `main` when repository-admin capability is available.
6. Stage 1: final cleanup/handover and zero-drift proof.

## Mandatory safety rules
- Before every write, re-fetch development/main HEAD and review concurrent commits.
- No force push.
- No unverified Production DDL.
- Never weaken RLS/tests to make CI green.
- Super Admin is the only implicit application bypass; business role names are labels only.
- Permission-First + canonical branch/RLS isolation.
- Trusted `service_role` backend contracts must be explicit and frontend-inaccessible.
- Clean/organize only within the touched repair scope.
- Final target: `Published Site = Verified Main = Production DB Contract = Zero Drift`.