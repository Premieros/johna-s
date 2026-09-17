# UI Operational Audit Execution Log — 2026-09-17

## Identity
- Repository: `Premieros/johna-s`
- Baseline `main`: `21c076a5bb71cf860de28f80df45bff41e17eccd`
- Working branch: `development/ui-operational-audit-20260917`
- Production changes: NONE
- Production migrations: NONE
- Printing changes: NONE

## Audit findings accepted for remediation
1. Header Active Orders shortcut is visible without checking `floor_plan.view`.
2. User identity control routes directly to Settings even without `settings.manage`.
3. Desktop sidebar/header side logic is inconsistent for English LTR.
4. Dashboard clickable metrics can advertise destinations without permission-aware rendering.
5. POS Send-to-Kitchen immediate state path deserves regression verification for the session-local fallback.
6. Menu density and finance permission granularity require documentation, not contract changes in this branch.

## Phase history

### Phase 0 — Baseline and documentation
Status: COMPLETE

Actions:
- Read actual `main` branch state before changing anything.
- Confirmed baseline SHA: `21c076a5bb71cf860de28f80df45bff41e17eccd`.
- Created isolated branch `development/ui-operational-audit-20260917` from that exact SHA.
- Created staged remediation plan and this execution log.

Commits:
- `9529ce61ae38dc3e2ed7ad8c44fab1ba1c1fef0b` — staged operational UI remediation plan.
- `e63dc7b1729460f7e3669814c0e942a26dedc063` — execution log creation.

Verification:
- No source code changed in Phase 0.
- No active parallel branch touched.
- No Production/DB/printing action performed.

### Phase 1 — Permission-aware application shell
Status: COMPLETE

Actions:
- Added explicit `floor_plan.view` gating for the global Active Orders shortcut.
- Changed Active Orders navigation to the canonical `APP_ROUTES.floorPlan` route constant.
- Added explicit `settings.manage` gating to the user identity control.
- Users without `settings.manage` still see their identity, but the control is disabled and no longer acts as a misleading Settings shortcut.
- Existing `ProtectedRoute` checks remain unchanged as defense in depth.

Files:
- `src/components/Layout.tsx`

Source commit:
- `3dee157b46839777b24170734fb7863d4e8cd1c4`

Verification:
- No permission names changed.
- No route guards removed or weakened.
- No RLS/DB/Production/printing changes.

### Phase 2 — RTL/LTR shell correctness
Status: COMPLETE

Actions:
- Unified sidebar placement on logical `start-0`.
- Arabic RTL therefore keeps the sidebar on the right; English LTR places it on the left.
- Unified fixed-header desktop offset on logical `lg:start-[260px]`.
- Unified main content desktop offset on logical `lg:ms-[260px]`.
- Corrected closed mobile drawer transform: RTL exits right; LTR exits left.

Files:
- `src/components/Layout.tsx`

Source commit:
- `3dee157b46839777b24170734fb7863d4e8cd1c4`

Verification:
- Logical CSS preserves a single implementation for both directions.
- Sidebar border remains `border-e`, so it stays on the inner edge in both RTL and LTR.
- No business logic changed.

### Phase 3 — Permission-aware dashboard navigation
Status: COMPLETE

Actions:
- Added `useCan()` to the dashboard action layer.
- The New Sale CTA is shown only when the user has both `pos.view` and `pos.order.create`.
- KPI cards remain visible as read-only metrics, but become links only when `reports.view` is available.
- The low-stock list remains visible, but inventory navigation is enabled only with `inventory.view`.
- Read-only metric presentation uses `aria-disabled` rather than redirecting users into route guards.

Files:
- `src/features/dashboard/pages/DashboardDataPage.tsx`

Source commit:
- `8c28cc75ffd263d2f128842321b382398fc1ffe7`

Verification:
- No dashboard data calculation changed.
- No report/inventory/POS authorization contract changed.
- Existing route guards remain unchanged.
- No DB/Production/printing changes.

### Phase 4 — POS immediate Send-to-Kitchen -> Pay state
Status: COMPLETE — FINDING DOCUMENTED / SOURCE CHANGE DEFERRED

Finding:
- `kitchenSendsForActive` intentionally provides a session-local fallback after a successful `send_to_kitchen` RPC and before Realtime delivers the same rows.
- `hasUnsentItems` reads `kitchenSendsForActive`, but its `useMemo` dependency list is `[pos.cart, kitchenSendsByOrder, orderItemsForActive]`.
- Because `pos.kitchenSentItems` can update the fallback without changing `kitchenSendsByOrder`, the memo can temporarily retain a stale `hasUnsentItems` value until Realtime arrives.

Required fix in the POS-owning workstream:
- Depend directly on `kitchenSendsForActive` in `hasUnsentItems`.
- Add a regression test covering: successful Send-to-Kitchen -> session fallback updated -> Pay immediately, before Realtime delivery.

Reason source change was deferred here:
- The user explicitly requested this work not interfere with the other model's active workstream.
- `PosWorkspacePage.tsx` is a high-conflict operational file, so this audit branch records the exact defect rather than creating an avoidable merge conflict.

Verification:
- No POS source changed.
- No stock deduction, send-to-kitchen RPC, Realtime, RLS, Production, or printing behavior changed.

Next:
- Phase 5: navigation density and permission-granularity recommendations.
