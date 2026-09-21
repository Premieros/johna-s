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
**Status: IN PROGRESS**

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
