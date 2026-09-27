# Permission Runtime Alignment — 2026-09-27

Branch: `development/permission-runtime-alignment-20260927`
Current PR: `#387`
Last updated: 2026-09-27

## Work status
State: **BLOCKED**

## Guardrails
- Repository: `Premieros/johna-s` only.
- Production Supabase: `azzdesuowpdcoflmyezn` only.
- Base: `main@565c8b317a920c9dfb19b4ba978f54a1309d76af`.
- This branch supersedes stale PR #383 after priority PRs #385 and #386 were merged to main.
- Permission-First: Super Admin is the only implicit bypass.
- No direct writes to `main`; no force push.
- Printing / Print Agent / routing / KDS / send-to-kitchen transport are frozen and must not be modified.
- No Production migration or live role-permission rewrite without exact-head Full Verify Green and explicit approval.
- Existing Production role assignments are audit inputs only; this package does not normalize live roles automatically.
- Before every write, re-check branch HEAD and `main`; unexpected movement => STOP_AND_RECONCILE.
- Stop before merge even if all gates are Green.

## Baseline
- Production read-only audit previously confirmed `can_permission()` is permission-driven with Super Admin bypass only.
- `user_may_access_branch()` enforces branch access; Super Admin is the only platform-wide branch bypass.
- `guard_role_permissions()` prevents non-Super-Admin users from granting permissions they do not own.
- `guard_user_role_changes()` prevents self-elevation, out-of-scope branch/user changes, and assigning roles with unowned permissions.
- No current Production RLS policy was found authorizing by ordinary operational role names.
- Confirmed UI drift on latest main: `ApprovalInbox` still gates by branch_manager / owner / super_admin rather than `approvals.review`.
- Confirmed UI drift on latest main: `CashierDiscountApprovalCard` still resolves literal cashier role instead of permission capability.
- Confirmed discount approval defect: percent requests store the entered percent in `discount_amount`, while settlement authorizes against monetary discount value.
- Previous PR #383 verification reached 1125/1130 unit tests and failed only because introducing `useCan()` inside `CashierDiscountApprovalCard` made isolated PaymentPanel component tests require AuthProvider. This iteration fixes the dependency boundary rather than weakening tests.

## Root-cause ledger
1. Approval UI retained role-name visibility checks from an older authorization model.
2. Discount approval payload conflates percentage input with monetary discount value.
3. Permission lookup was initially placed too deep in a leaf checkout component; isolated component tests correctly exposed the hidden provider dependency.
4. The POS workspace already has permission state via `usePosPermissions()`; the capability should be passed downward explicitly rather than resolved again in the leaf.
5. Role-name checks elsewhere must be classified before change; Super-Admin-only platform checks are legitimate and must remain.

## Change ledger
- Pending on latest-main rebuild.

## Verification ledger
- Previous stale PR #383:
  - worklog gate repaired.
  - lint/typecheck/app+test typecheck passed.
  - unit: 1125/1130 passed; all 5 failures were `tests/components/pos-payment-panel.test.tsx` due to leaf `useCan()` requiring AuthProvider.
  - build/DB/browser skipped after unit failure.
- Priority PR #385 merged.
- Priority PR #386 merged.
- Latest-main rebuild started from `565c8b317a920c9dfb19b4ba978f54a1309d76af`.
- No Production writes performed.

## Production gate
- No Production migration planned for this package.
- No Production data/role permission writes planned.
- Merge requires exact-current-head Full Verify Green.
- Any Production mutation requires separate explicit approval.
- Merge itself is explicitly blocked until user approval after all checks.

## Next action
1. Rebuild ApprovalInbox on latest main with `approvals.review`.
2. Rebuild discount approval so capability is passed from POS workspace / permission state, not resolved in the leaf component.
3. Store monetary discount in approval payload while preserving entered percent metadata.
4. Add regression contract for Permission-First approval runtime and the leaf-component provider boundary.
5. Run focused tests, then full repository verification.
6. Stop before merge.

## Mandatory update protocol
- Before each logical write: read `Next action`, `Change ledger`, and `Verification ledger`; re-check branch and main HEADs.
- After each logical group: record changed files and exact behavior.
- After each verification: record exact head and result.
- Do not mark merge-ready until exact-current-head Full Verify is Green.
