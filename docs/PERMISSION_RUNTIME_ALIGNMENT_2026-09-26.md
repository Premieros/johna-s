# Permission Runtime Alignment — 2026-09-26

Branch: `development/permission-runtime-alignment-20260926`
Current PR: `#383`
Last updated: 2026-09-26

## Work status
**BLOCKED**

## Guardrails
- Repository: `Premieros/johna-s` only.
- Production Supabase: `azzdesuowpdcoflmyezn` only.
- Branch: `development/permission-runtime-alignment-20260926`.
- Base: `main@8cd21d8dce34712f897f06e088eec70dc38a1956`.
- Permission-First: Super Admin is the only implicit bypass.
- No direct writes to `main`; no force push.
- Printing / Print Agent / routing / KDS / send-to-kitchen transport are frozen and must not be modified.
- No Production migration or permission-data rewrite without exact-head Full Verify Green and explicit approval.
- Existing Production role assignments are audit inputs only; do not normalize or broaden/reduce live role permissions in this package without separate approval.
- Before every write, re-check branch HEAD and `main`; unexpected movement => STOP_AND_RECONCILE.

## Baseline
- Production audit confirms `can_permission()` is role-permission driven with Super Admin bypass only.
- `user_may_access_branch()` enforces explicit branch access; Super Admin is the only branch-wide bypass.
- Production `guard_role_permissions()` prevents non-Super-Admin managers from granting permissions they do not own.
- Production `guard_user_role_changes()` prevents self-elevation, out-of-scope branch/user changes, and assignment of roles containing unowned permissions.
- No current Production RLS policies were found authorizing by ordinary role names.
- Confirmed UI drift: `ApprovalInbox` is gated by role names rather than `approvals.review`.
- Confirmed UI drift: `CashierDiscountApprovalCard` is gated by the literal `cashier` role rather than capability/permission state.
- Confirmed discount approval mismatch: percentage approval payload sends the entered percentage as `discount_amount`, while settlement authorizes against the monetary discount value.

## Root-cause ledger
1. Approval UI was added before the final Permission-First reconciliation and retained role-name visibility gates.
2. Percentage discount request payload conflates user-entered percent with server-authorized monetary discount amount.
3. Some role-name checks in `src/` are legitimate Super Admin/platform scoping or non-authorizing presentation/default-routing checks; only operational authorization gates should be converted.
4. Production custom roles may be intentionally broad; live role permissions are not changed automatically by this cleanup.

## Change ledger
- `src/components/ApprovalInbox.tsx`: replaced ordinary role-name visibility gate with canonical `can('approvals.review')`; branch-scoped loading and server decision RPCs remain unchanged.
- `src/features/pos/components/checkout/CashierDiscountApprovalCard.tsx`: removed literal cashier-role detection; the manager-approval card is now shown whenever the user lacks direct `pos.discount`.
- Discount approval payload now stores the monetary discount in `discount_amount`; for percentage input it additionally stores `requested_value` and preserves `discount_type='percent'`. Approved UI input is capped to 100% or subtotal for amount discounts so settlement and approval match.
- `tests/unit/permissionRuntimeAlignmentContract.test.ts`: added source contracts preventing regression to ordinary role-name authorization in the approval inbox/discount approval path and locking monetary percent-approval semantics.
- Remaining reviewed role-name checks in routing/navigation are either Super-Admin-only platform bypass or non-authorizing landing/display logic; no further ordinary-role authorization drift has been proven in the reviewed surfaces.
- No backend/RLS/Production role-data changes; print/KDS/kitchen-send paths untouched.

## Verification ledger
- Verify #2999 / 36250269870 failed only at the mandatory worklog gate before lint/type/unit/build/DB/browser: the log used bullet-prefixed Branch metadata and omitted exact top-level `Current PR` / `Last updated` fields required by `activeWorklogGateContract`. This is documentation-gate drift only; runtime tests were not reached.
- Read-only Production permission/RLS audit completed before implementation.
- No Production writes performed.

## Production gate
- No Production migration planned unless a backend contract defect is proven to require one.
- Live role permission rows will not be rewritten by this package.
- Merge requires exact-head Full Verify Green.
- Any Production mutation requires separate explicit approval.

## Next action
1. Run focused unit/type verification for the permission runtime contract and touched components.
2. If focused verification is Green, run the repository verify workflow on the current head.
3. Classify any failure before changing runtime; do not expand scope unless a regression proves another authorization drift.
4. Exact-head Full Verify must be Green before merge; stop before merge for explicit approval.

## Mandatory update protocol
- Before each logical write: read this log's `Next action`, `Change ledger`, and `Verification ledger`; re-check branch and main HEADs.
- After each logical group: record changed files and exact behavior.
- After every verification: record exact head and result.
- Do not mark merge-ready until exact-current-head Full Verify is Green.
