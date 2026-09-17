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

1. Normal **Close Shift** fails closed when the branch still has an effective `open`/`held` order containing a positive-quantity line that is not already paid.
2. A separate **Close Shift With Open Orders** action is available only with both `shifts.close` and `shifts.close_with_open_orders`.
3. The override closes the drawer/shift only. It must not cancel, pay, complete, move, or otherwise mutate open orders, and it must not mark occupied tables vacant.
4. Preserved orders/tables continue operationally into the next shift. Later payment is attributed through the then-open branch shift while the original order ownership remains intact.
5. Final **Day Close** remains stricter and is not represented by the shift-close button.

## Implementation
### 2026-09-17 — initial implementation
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

### 2026-09-17 — CI-proven repairs on PR #173
PR: `#173` — `harden(shifts): safe close with open-order override`

Initial PR head inspected in GitHub: `6ca468769fc765283ce62ed5b2982960562b9564`.

Verify run `#1633` / run ID `35209973034`:
- frontend API contract, lint, typecheck, unit and build passed;
- DB integration/security/RLS failed;
- browser smoke was skipped because the DB job failed.

Actual failure analysis from the uploaded integration log found two classes of issues introduced/exposed by the new guard:
1. The new `shift_close_open_orders_guard` fixture inserted an order item without a branch-valid product, causing `PRODUCT_NOT_IN_BRANCH`.
2. Existing lifecycle tests use the shared RLS fixture, which intentionally contains an open order for policy probing; the new branch-wide close guard correctly treated that synthetic order as operational unless the test isolated it.

Repairs made on the same branch only:
- `a4832db3979e06118c694f19bec94c459638f3c4` — first refinement of effective-open-order counting.
- `5d533944786449c58d4f463aede83038ee09048b` — seeded a real branch product in the new guard fixture and linked the order item to it.
- Verify `#1635` then exposed an invalid attempted `sales.order_id` relationship and a bind-parameter mismatch in the new test fixture.
- `dd7c1cf2d786a5011dde22178fe18633553e3ba8` — switched settlement detection to the canonical order state: `orders.payment_status <> 'paid'`; no RLS or permission weakening.
- `3fd5d716f8a6cedde37f1f8cb44f42f338decc73` — corrected the user-fixture bind parameters.
- Verify `#1637` proved the new five-case shift-close guard test Green; only three unrelated existing tests remained blocked by the shared synthetic RLS probe order.
- `311dd8362cf261ff95d26edcdb26d5d14fcd4a8c` — isolated the synthetic RLS probe order in `functional_core_cycle.test.ts` by marking only that test fixture row settled.
- `2c269f2bce2bd109c30142ded39d65ba144df08a` — applied the same isolation in `shift_live_expected_consistency.test.ts`.
- `d85a6429d726de55ad22d57f3d52fe6795d87836` — applied the same isolation in `pos_operational_lifecycle.test.ts`.

The production guard remains strict: a branch order in `open`/`held` state with positive quantity and `payment_status` not `paid` blocks normal shift close. The RLS policies and Permission-First authorization were not relaxed.

## Validation State
### Full Verify Green — PR functional head
Verify run `#1640` / run ID `35211531062` on exact head `d85a6429d726de55ad22d57f3d52fe6795d87836` completed Green:
- locked Supabase project identity ✅
- frontend API contract ✅
- lint ✅
- application typecheck ✅
- application + test-suite typecheck ✅
- unit tests ✅
- production build ✅
- canonical migrations on the ephemeral CI PostgreSQL service ✅
- schema verification ✅
- integration + security/RLS regression tests ✅
- browser smoke / Playwright ✅

CI database migrations above were applied only to the disposable CI PostgreSQL service. They were not applied to Production Supabase.

This documentation commit changes no application, database, RLS, permission, printing, or mobile behavior. Its final PR head must still receive a fresh Full Verify before merge.

## Merge / Production State
- Pull request: `#173` open at the time of this log update.
- Functional Full Verify: Green on `d85a6429d726de55ad22d57f3d52fe6795d87836` via run `#1640`.
- Final documentation-head Verify: pending after this log commit.
- Merged to `main`: no at the time of this log update.
- Production migration applied: **no**.
- Production Supabase was not modified by this validation/repair cycle.
- Printing / Print Agent modified: **no**.
- Mobile application modified: **no**.
