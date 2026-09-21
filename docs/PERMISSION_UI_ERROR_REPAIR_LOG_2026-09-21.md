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
**Status: FULL VERIFY GREEN**

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
**Status: FULL VERIFY GREEN**

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
**Status: FULL VERIFY GREEN**

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
**Status: IMPLEMENTED — FINAL VERIFY PENDING**

- New-order controls use `pos.order.create`.
- Existing-order mutations use `pos.order.edit`.
- Payment, print, send-kitchen, transfer, Void, and cancel buttons follow their own permissions.
- Disabled controls must not show an unrelated reason such as “no open shift” when the real reason is permission.
- Approval-based actions should remain reachable when approval is the intended server path.

### Phase 5 — POS partial-degradation behavior
**Status: IMPLEMENTED — FINAL VERIFY PENDING**

- A nonessential query failure must not unnecessarily replace the entire POS with a fatal screen.
- Keep the POS usable when safe fallback data is available.
- Surface the affected subsystem in a localized warning.
- Fatal screen only when the POS cannot safely operate.

### Phase 6 — Verification
**Status: IN PROGRESS**

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


### 2026-09-21 — Phase 1 Full Verify GREEN; Phase 2 opened
- Verified exact HEAD: `b5493f6c41261a70306a785b9571a16bf364d8d5`.
- Workflow: `Verify main` run `35577449377`.
- Results:
  - lint ✅
  - TypeScript ✅
  - test-suite typecheck ✅
  - unit ✅
  - build ✅
  - canonical migrations ✅
  - schema verification ✅
  - Integration / Security / RLS ✅
  - Browser Smoke / Playwright ✅
- The action-specific permission contract is now verified Green without applying its migration to Production.
- `main` was rechecked before Phase 2 and remained at `ff2152b8f9849e9c03376fb69d87c83432f795d3`; the development branch remained ahead with no parallel main change to reconcile.
- Phase 2 starts from current repository code only. Confirmed UI defects:
  - unsent-line removal is still coupled to `canDeleteItem -> pos.void`;
  - a sent line can become inaccessible to the approval path because the Void control is hidden/disabled when the user lacks the direct Void capability;
  - the server already preserves the manager-approval path for users without direct `pos.void`.
- Phase 2 implementation boundaries:
  - unsent removal follows create/edit authority for the current order;
  - sent-item Void remains routed through `cancel_sent_order_item_exact`;
  - direct `pos.void` affects whether execution is immediate, not whether the approval request UI is reachable;
  - no print trigger, print queue, print-agent, printer route, kitchen station routing, or inventory algorithm redesign.
- Production writes: NONE.
- Production migrations applied: NONE.


### 2026-09-21 — Phase 2 implementation checkpoint
- Development HEAD before verification: `23b2a6d8db682c2534e6e4aec5f1082c494df3e4`.
- `main` rechecked and still unchanged at `ff2152b8f9849e9c03376fb69d87c83432f795d3`.
- Implemented UI-only permission split:
  - `canDeleteItem` now represents unsent order-line edit authority (`pos.order.edit`);
  - new `canVoidSentItem` represents direct sent-item Void authority (`pos.void`);
  - current/new order context still uses `canModifyCurrentOrder` so create-only users can remove an unsent line from the order they are creating.
- Sent-item approval path repair:
  - sent-line Void/request control is no longer hidden solely because direct `pos.void` is absent;
  - fully sent quantity decrease routes to the controlled Void callback even when normal order-edit authority is absent;
  - partially sent lines still require normal edit authority while removing only their unsent delta;
  - the modal explicitly distinguishes direct Void from manager approval request.
- Server boundary remains unchanged in Phase 2:
  - same `cancel_sent_order_item_exact` RPC;
  - same approval-request logic;
  - same audited inventory restoration path;
  - no new migration added for Phase 2.
- Added regression contract:
  - `tests/unit/posVoidApprovalUiContract.test.ts`.
- Printing / print-agent / printer routing / kitchen station routing changes: NONE.
- Production writes: NONE.
- Production migrations applied: NONE.
- Full Verify run for this exact HEAD: `35578569475` — pending.


### 2026-09-21 — Phase 2 first Full Verify failure and test-contract repair
- Exact failed HEAD: `efc5203ac8a762f6793ee9f92f71bd28abc14da3`.
- Verify run: `35578605841`.
- lint ✅
- TypeScript ✅
- test-suite typecheck ✅
- unit ❌
- DB and Browser Smoke were skipped because the verify job stopped at unit tests.
- Unit summary: 163 files passed, 2 failed; 840 tests passed, 2 failed.
- Both failures were stale literal-text assertions in existing tests:
  - `tests/unit/posSentItemEditGuard.test.ts`
  - `tests/unit/posVoidAndEmptyTableRepairContract.test.ts`
- No runtime/permission logic failed. The old tests expected the former fixed sentence containing `pos.void`, while Phase 2 intentionally changed the modal to explicitly branch on `canDirectVoid` and show either direct Void or manager-approval copy.
- Updated the existing tests to assert the new semantic contract rather than restoring obsolete UI text:
  - commit `488e13a450e112b763ca77fceb00fe19935cba62`
  - commit `4990cbcb8a2031d0f1218e3fc4387935e1f2ca3b`
- No Production writes.
- No Production migrations applied.
- No print-agent / print-routing / kitchen station changes.
- Phase 2 remains IN PROGRESS until the new exact HEAD passes Full Verify.


### 2026-09-21 — Parallel main synchronization before Phase 2 reverify
- While Phase 2 was being repaired, `main` advanced from `ff2152b8f9849e9c03376fb69d87c83432f795d3` to `9e14cf5b2421809dfad3fd6b60a977b999fa2c47` via merged PR `#287`.
- The incoming PR is visual-only (surface/accent/typography work).
- Compared changed-file sets against this repair branch before synchronization:
  - repair branch changed files: Permission/Void/error-plan files and associated tests/migration;
  - incoming main changed files: shared visual surfaces/styles/report/admin presentation files;
  - exact overlap: **NONE**.
- Synchronized latest main into this development branch with a real two-parent merge commit:
  - merge commit: `bf509a451e9f962e22f06e542274e9590f0da4b5`
  - parent 1: repair branch `bcb1fb6b9c2f7513bfd29cf38116ccd94da68d56`
  - parent 2: main `9e14cf5b2421809dfad3fd6b60a977b999fa2c47`
- No Force Push.
- No direct write to `main`.
- No Production write or migration.
- No printing / Print Agent / printer routing / kitchen station routing modification.
- Phase 2 reverify must run from the post-sync HEAD, not the obsolete pre-#287 baseline.


### 2026-09-21 — Phase 2 Full Verify GREEN; Phase 3 opened
- Exact verified HEAD: `a0ce2bfb95808b5aa78082bf89f0252e9094c69b`.
- Workflow: `Verify main` run `35579769954`.
- Results:
  - lint ✅
  - TypeScript ✅
  - test-suite typecheck ✅
  - unit ✅
  - build ✅
  - canonical migrations ✅
  - schema verification ✅
  - Integration / Security / RLS ✅
  - Browser Smoke / Playwright ✅
- Phase 2 is now closed Green on top of latest main `9e14cf5b2421809dfad3fd6b60a977b999fa2c47`.
- Phase 3 starts from current repository state only.
- Phase 3 scope:
  - normalize structured RPC errors into user-facing messages;
  - prevent raw local modal / KDS / POS loader errors from reaching users;
  - preserve permission codes internally but show actionable Arabic/English text;
  - separate “no open shift” from “missing create/edit permission” in Product Browser.
- No Production writes.
- No Production migration application.
- No print-agent / print-routing / kitchen station routing changes.


### 2026-09-21 — Phase 3 implementation checkpoint
- Scope implemented from current branch state only; no memory-derived code assumptions.
- Central error normalization:
  - structured RPC errors such as `{ error: 'PERMISSION_DENIED', permission: 'pos.payment.take' }` now preserve the permission name for the user-facing message;
  - added operational mappings for common POS/KDS/table/order/branch errors;
  - unknown `UPPER_SNAKE_CASE` technical codes no longer surface literally in English;
  - `ORDER_OPERATOR_REQUIRED` copy is now action-neutral and does not falsely demand unrelated manage/transfer permissions.
- Local UI surfaces converted away from raw `.message` / raw RPC code rendering:
  - `TransferOrderModal.tsx`
  - `TransferItemModal.tsx`
  - `TransferItemsModal.tsx`
  - `KitchenDisplayPage.tsx`
  - `ActiveOrdersPage.tsx`
  - POS cancellation path in `PosWorkspacePage.tsx`
  - catalog/image failures in `ProductBrowser.tsx`
- KDS:
  - load/context failures are translated;
  - Start Cooking / Ready / Served failures are no longer silently swallowed;
  - last known queue cards remain visible on failure.
- Product Browser:
  - missing shift and missing order create/edit authority are now distinct reasons;
  - “Go to shifts” appears only when the shift is actually the blocker;
  - inventory availability codes are translated instead of rendered raw.
- POS initial load resilience:
  - product catalog failure is the only online-load failure allowed to block POS after offline fallback also fails;
  - customer/settings/branches/categories/areas failures degrade to a non-blocking warning;
  - cached product catalog recovery remains available and produces a non-blocking warning rather than a fatal screen.
- Regression coverage added/extended:
  - `tests/unit/userFacingError.test.ts`
  - `tests/unit/posUserFacingErrorSurfaceContract.test.ts`
- No Production writes.
- No Production migrations applied.
- No print-agent / printer queue / printer routing / kitchen station routing changes.
- Phase 3 status remains IN PROGRESS until Full Verify is Green on the exact post-documentation HEAD.


### 2026-09-21 — Phase 3 first Full Verify failure and stale-test repair
- Failed exact HEAD: `0afedc8049da61fc4fe7ae6750e8a8cd16cb150d`.
- Verify run: `35581205223`.
- lint ✅
- TypeScript ✅
- test-suite typecheck ✅
- unit ❌
- DB / Browser Smoke skipped because verify stopped at unit tests.
- Unit summary: 164 files passed, 3 failed; 854 tests passed, 3 failed.
- All three failures were stale literal/source-shape assertions rather than runtime logic failures:
  - `kdsVisibleFailureContract.test.ts` expected the removed local `errorMessage()` helper instead of the new centralized translator;
  - `posRawShortageSellabilityContract.test.ts` expected a hard-coded `RAW_MATERIAL_NOT_IN_BRANCH` branch instead of centralized availability-code translation;
  - `recentUiWiringContract.test.ts` expected the old misleading “open shift” sentence even when permission could be the blocker.
- Updated the existing tests to assert the new semantic contracts:
  - KDS still preserves the last known queue and now asserts `userFacingErrorMessage(...)`;
  - invalid availability/configuration still blocks sale while its code is translated centrally;
  - catalog gating explicitly distinguishes `shift` vs `permission`.
- Repair commits:
  - `0e7b10b151982b49bb43a1892aa0e16bb7bc2d1d`
  - `5ef1bc97ba440087a87c24759c1b5fe69ab6ea23`
  - `29bcca14ad70970df21cdce13343dea6b11f4267`
- Production writes: NONE.
- Production migrations applied: NONE.
- Printing / Print Agent / printer routing / kitchen station routing changes: NONE.
- Phase 3 remains IN PROGRESS until the new exact HEAD passes Full Verify.


### 2026-09-21 — Phase 3 Full Verify GREEN; Phase 4 opened
- Exact verified HEAD: `773065b74d4c18120acce2a3d42493782cf44607`.
- Workflow: `Verify main` run `35581542219`.
- Results:
  - lint ✅
  - TypeScript ✅
  - test-suite typecheck ✅
  - unit ✅
  - build ✅
  - canonical migrations ✅
  - schema verification ✅
  - Integration / Security / RLS ✅
  - Browser Smoke / Playwright ✅
- Phase 3 is closed Green.
- Phase 4 opened from the current repository state only.
- No Production writes.
- No Production migrations applied.
- No print-agent / printer queue / printer routing / kitchen station routing changes.


### 2026-09-21 — Phase 4/5 implementation complete; Phase 6 final verification opened
- Phase 4 corrections completed from current repository code:
  - new-order customer action uses effective create-or-edit authority instead of always requiring `pos.order.edit`;
  - Active Orders payment is gated by `pos.payment.take`;
  - Active Orders cancellation is gated by `pos.cancel_order`;
  - vacant-table new-order action is gated by `pos.order.create`;
  - operator reassignment is gated only by `pos.order.transfer`;
  - operator reassignment now uses `transfer_order_operator` instead of direct `orders.cashier_id` mutation;
  - transfer target discovery now uses `listOrderTransferTargets` instead of directly reading the `users` table.
- Added UI guard regression:
  - `tests/unit/posUiGuardPermissionContract.test.ts`.
- Phase 5 implementation was already completed during Phase 3 and is now locked for final verification:
  - secondary POS data failures degrade to a non-blocking warning;
  - product catalog remains the only blocking load dependency after cache fallback also fails;
  - cached catalog fallback remains available.
- Existing Phase 6 coverage confirmed from repository tests, without duplicating suites:
  - `pos_action_specific_cross_operator_permissions.test.ts`: payment-only, receipt-print-only, send-kitchen-only, cancel-only, cross-branch denial;
  - `pos_operator_ownership.test.ts`: transfer-only authorization, cross-branch target denial, audit and ownership transfer;
  - `functional_core_cycle.test.ts`: order → hold/resume → kitchen → payment → inventory → shift close and branch denial;
  - granular POS permission unit coverage remains in `tests/features/pos/pos-permissions.test.ts`.
- Final gate: Full Verify on exact post-documentation HEAD.
- Production writes: NONE.
- Production migrations applied: NONE.
- Printing / Print Agent / printer routing / kitchen station routing changes: NONE.
