# FINAL BUG REGISTER

> Source of truth for remaining confirmed deviations. Update after every verified fix batch and when a newly confirmed root-cause is admitted into the final-stage plan.

## Fixed identity
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn` ONLY
- Production branch: `main`
- Development branch: `development/final-handover`
- Verified Production baseline: `main@85e6ce1df0f12b7eaca73ca283bef41a6703b828` (PR #48)

## Counting rules
- Count only confirmed, unique root-cause deviations.
- Do not count one intentional and guarded exposure as a defect.
- Do not double-count symptoms that share one root cause.
- Runtime/UI items are counted only after reproduction or direct contract verification.
- Every code/database fix must preserve closed contracts and pass Regression -> Full Verify -> Merge -> Production Post-Check -> merged-main Verify/Deploy.

## Current confirmed unique deviations: 2

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
Evidence:
- PR #47 ✅.
- pre-merge Verify #875 Full Green ✅.
- merged `main@952c9954cbbebf760c44d75706ec569aac28a7bb` ✅.
- Production migration `shift_cash_integrity_and_scope` applied ✅.
- Production post-check ✅.
- merged-main Verify #876 Full Green ✅.
- Deploy #578 ✅.

#### RUNTIME-002 — POS operator ownership not centrally enforced — CLOSED ✅
Protected contract:
1. Shift is shared per branch.
2. POS access remains permission-driven.
3. New orders belong to `auth.uid()`; ordinary callers cannot spoof another cashier.
4. Only operational owner may normally edit/continue/pay/cancel/move an open/held order, subject to the exact action permission.
5. Dine-in table operational ownership derives from its active order.
6. Same-branch peers may see occupied state + narrow owner display label but cannot work the order/table.
7. Operator transfer requires `pos.order.transfer`, never a role-name check.
8. Source/target/order/table remain same-branch authorized.
9. Transfer records old owner, new owner, actor and timestamp.
10. Server-side enforcement is mandatory; direct-DML/RPC fallback bypasses fail closed.
11. Super Admin remains the only implicit bypass.
12. Shared-shift sale attribution is preserved without duplicate shift operation.

Closure evidence:
- PR #48 ✅.
- final pre-merge head `c981cde7e919613399e41016924952ac965cbc00`.
- pre-merge Verify #887 / run `34156244462`: Full Green ✅.
- merged `main@85e6ce1df0f12b7eaca73ca283bef41a6703b828` ✅.
- Production migrations applied ✅:
  - `20260907194314_pos_operator_ownership`
  - `20260907194337_pos_kitchen_send_ownership`
  - `20260907194427_pos_operator_rpc_ownership_hardening`
  - `20260907194454_pos_sale_shift_attribution`
- Production post-check verified ownership triggers, RPC grants, `search_path=public, pg_temp`, and Stage 4.1 `shift_operations` privilege non-regression ✅.
- merged-main Verify #888 / run `34156540119`: Full Green ✅ including Browser Smoke.
- Deploy #579 / run `34156540094`, attempt 2: Production parity ✅ and Pages deploy ✅.

Do not reopen RUNTIME-002 without a reproduced regression.

#### Stage 4.3 — Remaining Published Operating Cycle — ACTIVE 🟠
No new defect is counted merely because this audit is active.
Count only reproduced/directly verified root causes while testing:
- Login/bootstrap.
- shared shift/opening balance.
- all POS order types.
- KDS/send-once/delta.
- inventory deduction/no double consumption.
- payments/discounts/voids/returns.
- hold/resume/split/merge/transfer.
- shift close/day close/offline paths.
- products/components/recipes/costing.
- reports/guided routing/RTL-LTR/navigation.

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
- PR #48 POS operator ownership + controlled operator transfer.

## Current execution order
1. Stage 4.3: continue the published full operating cycle and count only reproduced deviations.
2. Stage 5 Auth/password remains externally blocked on the project Auth setting unless a valid write path becomes available; do not falsely close it.
3. Stage 3: validate printing end-to-end.
4. Stage 2: enforce required protection/checks on `main` when repository-admin capability is available.
5. Stage 1: final cleanup/handover and zero-drift proof.

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