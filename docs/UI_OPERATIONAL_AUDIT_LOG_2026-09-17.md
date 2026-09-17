# UI Operational Audit Execution Log — 2026-09-17

## Identity
- Repository: `Premieros/johna-s`
- Baseline `main`: `21c076a5bb71cf860de28f80df45bff41e17eccd`
- Working branch: `development/ui-operational-audit-20260917`
- Production changes: NONE
- Production migrations: NONE
- Printing changes: NONE

## Audit findings accepted for remediation
1. Header Active Orders shortcut was visible without checking `floor_plan.view`.
2. User identity control routed directly to Settings even without `settings.manage`.
3. Desktop sidebar/header side logic was inconsistent for English LTR.
4. Dashboard clickable metrics could advertise destinations without permission-aware rendering.
5. POS Send-to-Kitchen immediate state path has a memo dependency mismatch affecting the session-local fallback.
6. Menu density and finance permission granularity require a coordinated later design/contract change, not an ad-hoc change here.

## Phase history

### Phase 0 — Baseline and documentation
Status: COMPLETE
- Baseline `main`: `21c076a5bb71cf860de28f80df45bff41e17eccd`.
- Isolated branch created: `development/ui-operational-audit-20260917`.
- Plan commit: `9529ce61ae38dc3e2ed7ad8c44fab1ba1c1fef0b`.
- Log creation commit: `e63dc7b1729460f7e3669814c0e942a26dedc063`.

### Phase 1 — Permission-aware application shell
Status: COMPLETE
- Active Orders shortcut now requires `floor_plan.view`.
- User identity control no longer opens Settings without `settings.manage`.
- Route guards remain unchanged.
- Source commit: `3dee157b46839777b24170734fb7863d4e8cd1c4`.

### Phase 2 — RTL/LTR shell correctness
Status: COMPLETE
- Sidebar uses logical `start-0`: right in Arabic RTL, left in English LTR.
- Header uses logical `lg:start-[260px]`.
- Main content uses logical `lg:ms-[260px]`.
- Mobile drawer exits right in RTL and left in LTR.
- Source commit: `3dee157b46839777b24170734fb7863d4e8cd1c4`.

### Phase 3 — Permission-aware dashboard navigation
Status: COMPLETE
- New Sale requires `pos.view` + `pos.order.create`.
- KPI cards link to Reports only with `reports.view`; otherwise they remain read-only metrics.
- Low-stock entries link to Inventory only with `inventory.view`.
- Source commit: `8c28cc75ffd263d2f128842321b382398fc1ffe7`.

### Phase 4 — POS immediate Send-to-Kitchen -> Pay state
Status: COMPLETE — FINDING DOCUMENTED / SOURCE CHANGE DEFERRED

Confirmed finding:
- `kitchenSendsForActive` provides the session-local fallback after successful kitchen send.
- `hasUnsentItems` reads it, but its memo depends on `kitchenSendsByOrder` instead of `kitchenSendsForActive`.
- This can leave the UI stale until Realtime updates.

Required POS-workstream fix:
- Depend directly on `kitchenSendsForActive`.
- Add regression coverage for immediate Pay after successful Send-to-Kitchen before Realtime delivery.

No POS source changed here to avoid conflict with the separately active POS workstream.

### Phase 5 — Navigation density / permission granularity
Status: COMPLETE

Output:
- `docs/UI_OPERATIONAL_AUDIT_RECOMMENDATIONS_2026-09-17.md`

Documented:
- proposed reduction of persistent sidebar density without deleting routes;
- finance navigation permission granularity gaps;
- separation between view and mutation permissions;
- profile/settings separation;
- dashboard permission-first action rule;
- mobile POS CSS maintainability risk;
- exact POS dependency follow-up.

Source/document commit:
- `978e38af6757631cd7c315aaaea282e74fd01c93`.

### Phase 6 — Verification / handoff
Status: IN PROGRESS

Planned verification:
- compare branch against baseline `main`;
- inspect changed file list and diff scope;
- open PR from this isolated branch only;
- inspect CI/workflow status;
- do not merge without explicit user approval.

## Safety summary
- `main` direct edits: NONE
- Production Supabase changes: NONE
- Production migrations: NONE
- RLS changes: NONE
- Permission contract changes: NONE
- Printing changes: NONE
- Other active development branch changes: NONE
