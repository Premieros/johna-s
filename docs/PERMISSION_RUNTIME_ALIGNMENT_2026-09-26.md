# Permission Runtime Alignment — 2026-09-26

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
- Pending.

## Verification ledger
- Read-only Production permission/RLS audit completed before implementation.
- No Production writes performed.

## Production gate
- No Production migration planned unless a backend contract defect is proven to require one.
- Live role permission rows will not be rewritten by this package.
- Merge requires exact-head Full Verify Green.
- Any Production mutation requires separate explicit approval.

## Next action
1. Convert Approval Inbox visibility/decision UI to canonical `approvals.review`.
2. Convert discount approval request card away from literal role gating and make percent requests authorize the exact monetary discount value.
3. Add regression tests that reject ordinary role-name authorization gates in these permission-sensitive surfaces.
4. Sweep remaining `src/` role-name checks and classify each as Super Admin/platform-only, display/default-routing, or authorization drift; change only proven authorization drift.
5. Run focused unit tests, then Fast/Full Verify according to scope; stop before merge.

## Mandatory update protocol
- Before each logical write: read this log's `Next action`, `Change ledger`, and `Verification ledger`; re-check branch and main HEADs.
- After each logical group: record changed files and exact behavior.
- After every verification: record exact head and result.
- Do not mark merge-ready until exact-current-head Full Verify is Green.
