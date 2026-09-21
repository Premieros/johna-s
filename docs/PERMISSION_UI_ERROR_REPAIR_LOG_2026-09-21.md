# Permission Contract & User-Facing Error Repair Log — 2026-09-21

## Scope
This log tracks the ordered repair of POS permission-contract drift and unclear user-facing errors discovered during the UI audit.

## Repository / branch
- Repository: `Premieros/johna-s`
- Development branch: `development/permission-contract-ui-errors-20260921`
- Started from main HEAD: `ff2152b8f9849e9c03376fb69d87c83432f795d3`
- Production Supabase: `azzdesuowpdcoflmyezn`
- Production branch: `main`

## Hard safety rules
- Do not modify `main` directly.
- Do not force push.
- Do not apply migrations to Production before Full Verify is green and explicit user approval is given.
- Keep branch isolation / RLS intact.
- Permission-First: no role-name authorization; Super Admin remains the only implicit bypass.
- Do not redesign or alter the current print agent, print station routing, printer payload format, or branch printing workflow.
- Do not change stock deduction / kitchen-send accounting unless a regression test proves it is required for this repair.
- Do not touch any other repository or Supabase project.

## Problem statement
The UI audit found two classes of defects:

1. **Permission contract drift**
   - Some actions are shown as independently authorized by their own permission, but Production additionally requires the broad `can_manage_other_pos_orders()` bundle for orders owned by another operator.
   - This blocks valid users such as `POS payment only`, receipt-print users, and other action-specific operators.
   - The fix must authorize only the requested action and must not silently grant broad order-edit or user-management powers.

2. **Unclear / technical user errors**
   - Several POS/KDS dialogs render raw RPC/Postgres errors.
   - Some disabled actions display the wrong reason.
   - Some approval-capable flows are hidden before the user can request approval.

## Ordered repair plan

### Phase 1 — Action-specific permission contract
**Status: FIXED AFTER CI FAILURE — REVERIFY PENDING**

Target actions:
- `pos.payment.take`
- `pos.receipt.print`
- `pos.send_kitchen`
- `pos.order.transfer`
- `pos.void`
- `pos.cancel_order`

Rules:
- Each explicit permission must authorize only its declared action on an order in an allowed branch.
- Do not require `users.manage`, `pos.order.edit`, or `pos.order.transfer` merely because another operator owns the order unless that exact action genuinely requires them.
- Viewing/opening an active order is governed by `pos.view` + branch access; mutation remains protected by the exact action permission.
- Preserve order ownership attribution; paying another operator's order must not reassign the order or sale owner unless an explicit transfer occurs.

Acceptance cases:
- Payment-only user can open and pay a sent order belonging to another user in the same allowed branch.
- Payment-only user cannot edit, transfer, void, cancel, or change ownership.
- Print-only user can queue the allowed cashier receipt for another operator's order without gaining edit/transfer powers.
- Cross-branch access remains denied.
- Super Admin behavior remains unchanged.

### Phase 2 — Void / approval UI contract
**Status: PENDING**

- Unsent line removal must depend on `pos.order.edit`.
- Sent-item direct Void uses `pos.void`.
- User without direct `pos.void` must still be able to start the manager-approval Void path when server policy supports it.
- Preserve audited inventory restoration and existing kitchen/print behavior.
- Do not modify printer routing.

Acceptance cases:
- Sent item + direct Void permission => direct controlled Void.
- Sent item without direct Void => approval request is reachable from the UI.
- Unsent item with edit permission => removable without requiring Void.
- Inventory returns exactly once after successful controlled Void.

### Phase 3 — Unified user-facing errors
**Status: PENDING**

- Route operational errors through `userFacingErrorMessage`.
- Preserve structured fields such as `permission`, `action`, `detail`, and `error`.
- Never expose raw `PERMISSION_DENIED`, `ORDER_OPERATOR_REQUIRED`, SQLSTATE, PostgREST, RPC names, or RLS internals to normal users.
- Message must state:
  1. what action failed,
  2. why,
  3. what the user can do next.

Priority surfaces:
- POS workspace
- Active orders
- Transfer order/item modals
- Void flow
- KDS
- Shift modal
- POS load failures

### Phase 4 — UI guard correctness
**Status: PENDING**

- New-order controls use `pos.order.create`.
- Existing-order mutations use `pos.order.edit`.
- Payment, print, send-kitchen, transfer, Void, and cancel buttons follow their own permissions.
- Disabled controls must not show an unrelated reason such as “no open shift” when the real reason is permission.
- Approval-based actions should remain reachable when approval is the intended server path.

### Phase 5 — POS partial-degradation behavior
**Status: PENDING**

- A nonessential query failure must not unnecessarily replace the entire POS with a fatal screen.
- Keep the POS usable when safe fallback data is available.
- Surface the affected subsystem in a localized warning.
- Fatal screen only when the POS cannot safely operate.

### Phase 6 — Verification
**Status: PENDING**

Required checks before any Production migration or merge:
- lint
- TypeScript
- unit tests
- integration / security / RLS tests
- fresh DB / migration verification
- schema verification
- browser smoke
- permission-matrix regression

Permission matrix:
- View only
- Create only
- Edit
- Payment only
- Send kitchen
- Receipt print only
- Void
- Transfer
- Cancel
- Manager
- Super Admin

For each relevant role test:
- own order
- another user's order in same branch
- order in inaccessible branch

End-to-end regression:
- create order
- send to kitchen
- Void / approval
- transfer
- payment
- cashier receipt
- close order/table state
- verify inventory and audit trail

## Current audit findings locked for repair
- Payment-only contract is blocked for another operator's order by broad manage-other ownership checks.
- Receipt printing has the same hidden ownership bundle.
- Void manager-approval path exists server-side but is not always reachable from the UI.
- Unsent line deletion is incorrectly coupled to `pos.void`.
- POS product gating can report “no open shift” when the actual blocker is permission.
- KDS may show raw codes and silently swallow status-update failures.
- Several POS transfer dialogs display raw RPC/Postgres errors.
- Some calls discard the structured `permission` field and therefore lose the exact permission name in the user-facing message.

## Change log
### 2026-09-21 — Log initialized
- Created development branch from current `main`.
- Completed read-only audit of UI + Production permission functions.
- No Production write performed.
- No print-agent / printer-routing change performed.
- Phase 1 marked IN PROGRESS.


### 2026-09-21 — Phase 1 implementation checkpoint
- Development HEAD advanced with action-specific permission migration and regression tests.
- Added migration:
  - `supabase/migrations/20260921110000_action_specific_pos_permissions.sql`
- Added integration coverage:
  - payment-only across another operator's same-branch order
  - receipt-print-only queueing to the existing cashier station
  - send-kitchen across another operator while preserving ownership and single deduction
  - cancel-only across another operator without edit authority
  - cross-branch denial
- Added static safety contract test:
  - does not redefine/broaden `can_manage_other_pos_orders()`
  - does not alter printer settings, local print-agent routes, or kitchen station assignment
  - retains the existing `receipt -> cashier` cloud print route
- Updated older ownership/captain tests so they no longer encode the superseded rule that action permissions must fail solely because the order belongs to another operator.
- Production writes: NONE.
- Production migrations applied: NONE.
- Print Agent / printer routes changed: NONE.
- Next gate: Draft PR Full Verify. Phase 2 must remain pending until Phase 1 verification result is known.


### 2026-09-21 — Regression evidence from live UI
- User supplied a live POS screenshot showing the blocking ownership message while attempting an allowed cancellation/Void-related action on another operator's order:
  - `الطلب مسجل على مستخدم آخر. يلزم امتلاك صلاحيات إدارة ونقل طلبات المستخدمين الآخرين لتنفيذ الإلغاء.`
- This case is now a mandatory regression scenario for the repair.
- Expected contract after repair:
  - an explicit action permission authorizes only that exact action on another operator's order within the same allowed branch;
  - it must not require the broad `can_manage_other_pos_orders()` bundle;
  - it must not grant generic order edit, user-management, ownership-transfer, or cross-branch access.
- This evidence reinforces Phase 1 and Phase 2 acceptance criteria and must be verified before merge.
- Production changes performed for this evidence: NONE.
- Printing / print-agent / printer routing changes: NONE.


### 2026-09-21 — Live POS fatal-load regression confirmed
- User supplied a live screenshot from the POS route showing a full-screen fatal load state with a generic Arabic message equivalent to an unexpected POS data-load failure.
- Current `PosWorkspacePage` can promote non-product query failures into `loadError`, and once `loadError` is set it replaces the entire POS workspace.
- This confirms Phase 5 is a real operational issue, not only a static-code concern.
- Repair remains ordered behind Phase 1/2/3/4: nonessential failures (customers/settings/branches/categories/areas where safe fallback exists) must degrade to a localized warning instead of blocking the whole POS.
- A truly unavailable product catalog / unsafe branch context may still use a fatal screen.
- No Production change was made in response to the screenshot.


### 2026-09-21 — Phase 1 first Full Verify failure and repair
- Draft PR confirmed: `#286` — `fix(pos): align action permissions with cross-operator workflow`.
- Verified exact tested HEAD before failure: `ffb3bf80fc2142c5c52503d42f99ff635658e17b`.
- Workflow: `Verify main` run `35576424448`.
- Frontend job: GREEN:
  - lint ✅
  - TypeScript ✅
  - test suite typecheck ✅
  - unit ✅
  - build ✅
- DB job:
  - canonical migrations ✅
  - schema verification ✅
  - Integration/Security/RLS ❌
- Integration summary: 137 files passed, 1 file failed; 781 tests passed, 5 failed.
- All five failing cases were in the new `pos_action_specific_cross_operator_permissions.test.ts`.
- Root failure was the first Pay-Only scenario: `PERMISSION_DENIED:pos.order.edit`; the remaining four failures were cascading `25P02 current transaction is aborted` failures from the same test transaction.
- Root cause confirmed from current migration/trigger contract:
  - `enforce_pos_permission_mutation()` handled `NEW.status='completed'` before accepting the exact action context and therefore still required `pos.order.edit` during payment settlement bookkeeping.
- Repair commit: `7e4a3fe2d84eaa8e544899bd381396a2a93c3a83`.
  - The completion guard now accepts only the exact transaction-scoped `pos.payment.take` proof created by the controlled payment RPC.
  - Generic/manual edits remain protected by `pos.order.edit`.
  - No broadening of `can_manage_other_pos_orders()`.
- Regression contract test commit: `b2c2d647af080b2e499e5ff911d4f404b9ca099f`.
- Production writes: NONE.
- Production migrations applied: NONE.
- Print Agent / printer routes / station routing changed: NONE.
- Phase 2 remains blocked until the new exact HEAD completes Full Verify Green.


### 2026-09-21 — Phase 1 second Full Verify failure and repair
- Reverify run: `35576944395` on HEAD `6014ca4584924afcffe23d1873e66350ded01c2a`.
- Frontend verify remained GREEN.
- Canonical migrations and schema verification remained GREEN.
- Integration/Security/RLS failed again in the same new action-specific test file.
- Root failure changed from `PERMISSION_DENIED:pos.order.edit` to `ORDER_OPERATOR_REQUIRED`, confirming the previous edit-guard repair worked.
- DB log proved the remaining failure came from `guard_pos_operator_ownership()` while `process_sale` updated `payment_status` after the order had already transitioned to `completed`.
- Root cause:
  - `_pos_action_context_matches(..., 'pos.payment.take')` required the order to remain `open/held`.
  - During the same controlled settlement transaction, the final payment bookkeeping happens after status becomes `completed`, so the exact payment proof became false too early.
- Repair commit: `bbfe3438f0c01bbfce9f7c7b2135a1174364e9e1`.
  - The helper now permits `completed` only for the exact `pos.payment.take` transaction context.
  - Other action contexts remain restricted to active `open/held` orders.
  - Generic ownership/edit checks remain unchanged.
- Regression contract test commit: `d8cf89b16bf1a15e8f5115409ca1727d4be16e9c`.
- Production writes: NONE.
- Production migrations applied: NONE.
- Printing / Print Agent / printer routing / kitchen station routing changed: NONE.
- Phase 2 remains blocked until the new exact HEAD is Full Verify Green.
