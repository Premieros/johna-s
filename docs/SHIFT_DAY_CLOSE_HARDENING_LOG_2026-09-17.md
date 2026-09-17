# Shift / Day Close Hardening Log — 2026-09-17

## Scope
This log is the durable execution record for Shift/Day Close hardening only.

Repository: `Premieros/johna-s`

Production branch: `main`

Development branch: `development/shift-day-close-hardening-20260917`

Production Supabase: `azzdesuowpdcoflmyezn`

## Guardrails
- Do not modify `main` directly.
- No force push.
- Do not weaken RLS or tests.
- Permission-First only; Super Admin is the only implicit bypass.
- Do not copy migrations/RLS/RPC from other projects.
- Do not touch the current Print Agent / printing flow.
- Do not touch mobile-app work.
- Do not apply any migration to Production before Full Verify Green and separate explicit approval.
- Do not mix unrelated accounting, imports/exports, employee receivables, or POS hardening work into this scope unless a proven regression requires it.

## Starting Point
Latest verified `main` before this work: `b0e9099010aba14cde801d3c0a7d557e1ea7dbd1`.

Development branch was verified to match that same commit before implementation work began.

## Existing Coverage Confirmed
The project already contains Shift/Close coverage including:
- `tests/integration/close_shift_permission_first.test.ts`
- `tests/integration/shift_cash_integrity_scope.test.ts`
- `tests/integration/shift_live_expected_consistency.test.ts`
- `tests/integration/shared_branch_shift.test.ts`

Existing architecture already uses the server RPC `close_shift`; the UI does not directly mark the shift closed.

## Approved Operational Decision
Normal shift close and final financial day close are not the same action.

1. Normal **Close Shift** fails closed when the branch still has an effective `open`/`held` order containing a positive-quantity line.
2. A separate **Close Shift With Open Orders** action is available only with both `shifts.close` and `shifts.close_with_open_orders`.
3. The override closes the drawer/shift only. It must not cancel, pay, complete, move, or otherwise mutate open orders, and it must not mark occupied tables vacant.
4. Preserved orders/tables continue operationally into the next shift. Later payment is attributed through the then-open branch shift while the original order ownership remains intact.
5. Final **Day Close** remains stricter and is not represented by the shift-close button.

## Implementation
### 2026-09-17
- `219494b780b2fa291bba61b57c8ec1aa80da873e`
  - hardened `close_shift` to fail closed on effective open/held orders;
  - added `close_shift_with_open_orders` server RPC;
  - override preserves orders and dining-table occupancy;
  - override writes an audit event.
- `6b647e56caa49d6e390f5a1827a84b0f9e0a9c19`
  - exposed the new server RPC through the typed shifts API domain.
- `5138092bb015b2bee6bbf0910597f9d34e7bc18a`
  - added canonical `shifts.close_with_open_orders` permission;
  - added the permission to the Shifts permission group/checkbox list;
  - did not grant it implicitly to cashier or branch-manager defaults.
- `d18777a0a62e54c11ee0c6455ea6e2137b8a00a1`
  - changed the UI wording from combined day/shift close to shift close;
  - normal close displays open order/table counts when blocked;
  - override button is only shown after the block and only with explicit permission;
  - added explicit confirmation that orders/tables remain operational.
- `4b9684dad607fe3bb27d7aaa5bc1e8a0aec1478b`
  - tightened server authorization so override requires both `shifts.close` and `shifts.close_with_open_orders` for non-Super-Admin users.
- `f9eac0af071166e3e396d99e860e1d5778235a19`
  - added Integration regression coverage for normal-close blocking, permission enforcement, order/table preservation, retry safety, and branch isolation.

## Validation State
- Local/CI validation on the modified head has not yet been declared Green.
- Next step: open PR, run Full Verify, inspect all frontend/DB/browser jobs, and fix only proven regressions before merge.

## Merge / Production State
- Pull request: not opened yet.
- Full Verify: pending on the modified head.
- Merged to `main`: no.
- Production migration applied: no.
