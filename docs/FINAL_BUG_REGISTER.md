# FINAL BUG REGISTER

> Source of truth for remaining confirmed deviations. Update after every verified fix batch and when a newly confirmed root-cause is admitted into the final-stage plan.

## Fixed identity
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn` ONLY
- Production branch: `main`
- Development branch: `development/final-handover`
- Verified Production baseline: `main@8b671fca36d60a200e743a2192581d83c3fa1f6e` (PR #46)

## Counting rules
- Count only confirmed, unique root-cause deviations.
- Do not count one intentional and guarded exposure as a defect.
- Do not double-count symptoms that share one root cause.
- Runtime/UI items are counted only after reproduction or direct contract verification.
- Every code/database fix must preserve closed contracts and pass Regression -> Full Verify -> Merge -> Production Post-Check -> merged-main Verify/Deploy.

## Current confirmed unique deviations: 4

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

### Stage 4 — Published Runtime/UI — 2 confirmed root causes + active verification

#### RUNTIME-001 — Shift cash-integrity / scope drift — ACTIVE in PR #47
Confirmed defects already admitted into PR #47:
- authenticated direct DML on `shift_operations` could bypass trusted cash-operation RPCs;
- inconsistent expected-cash equations across get/close/force-close paths;
- non-canonical branch lookup in selected shift-control paths could expose mismatch state after unrestricted lookup.

Required closure:
- keep shared branch shift contract;
- preserve current close/approval permission contracts;
- canonical branch scope + no cross-branch oracle;
- Regression + Full Verify before Production.

#### RUNTIME-002 — POS operator ownership is not centrally enforced — QUEUED after PR #47
This is one root cause, not separate counts for each symptom.

Confirmed evidence from current Production contract:
- `orders.cashier_id` exists and is the natural owner/audit field.
- `create_order(...)` accepts optional `p_cashier_id` and can currently attribute a new order to a user other than `auth.uid()` without an explicit delegation/transfer permission contract.
- `update_order(...)` validates branch scope but does not require caller ownership (`orders.cashier_id = auth.uid()`) or a dedicated override/transfer permission.
- current table/order transfer paths are primarily branch-scoped and do not yet enforce owner + dedicated transfer permission consistently.
- `orders` and `dining_tables` RLS are currently branch-scoped for write access, so direct table DML/RPC bypass paths must be reviewed as part of the same root cause.

Approved operating contract for the repair:
1. Shift is shared per branch.
2. Any active user with `shifts.open` + branch access may open/reuse the branch shift.
3. POS access remains permission-driven.
4. New orders belong to the authenticated operator by default; ordinary users cannot spoof another cashier.
5. Only the operational owner may edit/continue/pay/cancel/move their order, subject to the fine-grained action permission itself.
6. A Dine-in table derives operational ownership from its active open/held order.
7. Other users in the same branch may see occupied state + owner display name but cannot work the table/order.
8. Transfer to another user requires a dedicated transfer permission, never a role-name check.
9. Source user, target user, order and table must all satisfy same-branch authorization.
10. Transfer writes audit trail for previous owner, new owner, actor and timestamp.
11. Server-side enforcement is mandatory; UI hiding alone is not closure.
12. Super Admin remains the only implicit bypass.

Required regression matrix:
- A/B same branch, same shared shift, both POS-authorized.
- A creates order/table; B can see occupied owner name but cannot modify/pay/cancel/transfer without transfer authority.
- caller cannot spoof `cashier_id` at create time.
- authorized transfer changes owner A -> B and B becomes the valid operator.
- cross-branch transfer/target fails fail-closed.
- KDS/inventory/payment attribution remains correct after ownership transfer.

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

## Current execution order
1. Stage 4.1: finish PR #47 shift cash-integrity batch and require Full Green before merge/Production.
2. Stage 4.2: implement POS Operator Ownership & Table Transfer as a separate root-cause batch.
3. Stage 4.3: continue the published full operating cycle and count only reproduced deviations.
4. Stage 5 Auth/password remains externally blocked on the project Auth setting unless a valid write path becomes available; do not falsely close it.
5. Stage 3: validate printing end-to-end.
6. Stage 2: enforce required protection/checks on `main` when repository-admin capability is available.
7. Stage 1: final cleanup/handover and zero-drift proof.

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
