# UI Operational Audit Execution Log — 2026-09-17

## Identity
- Repository: `Premieros/johna-s`
- Baseline `main`: `21c076a5bb71cf860de28f80df45bff41e17eccd`
- Working branch: `development/ui-operational-audit-20260917`
- Current HEAD: `3500d3879cff70e54e0d2f47621523f8ad24ebda`
- Pull request: `#178`
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
Status: IN PROGRESS — CI RE-RUNNING

PR:
- `#178` — `development/ui-operational-audit-20260917` -> `main`.

First CI attempt result:
- Database identity: PASS
- API contract: PASS
- Lint: PASS
- TypeScript / typecheck: PASS
- Unit tests: FAIL — 6 assertions out of 610, all caused by stale literal UI contract markers expecting the pre-audit implementation.
- Build: not reached after Unit failure.

Unit contract remediation completed without weakening coverage:
- `tests/unit/navigationRegression.test.ts`
  - now asserts canonical `APP_ROUTES.floorPlan` navigation;
  - asserts `floor_plan.view` permission gating;
  - asserts semantic logical RTL/LTR shell classes instead of obsolete hard-coded direction conditionals.
  - commit: `e06b4a32f3e3bbfc4133f0eb036cdf2e75ff00e7`.
- `tests/unit/sidebar-direction.test.ts`
  - now verifies logical inline-start behavior, RTL/LTR mobile drawer direction, header offset and main offset.
  - commit: `3a4d4a2e2822b66f84b4a6b91fd8cdd9dc496baf`.
- `src/lib/interactionIdentity.ts`
  - refreshed Active Orders interaction marker to canonical `APP_ROUTES.floorPlan` handler and updated label to reflect authorization-aware behavior.
  - commit / current HEAD: `3500d3879cff70e54e0d2f47621523f8ad24ebda`.

Current CI:
- Workflow: `Verify main`
- Run: `35245957789`
- Run number: `1663`
- State at latest check: PENDING / queued; no jobs emitted yet.

Merge rule:
- DO NOT MERGE until the new CI run is fully green and explicit user approval is received.

## Safety summary
- `main` direct edits: NONE
- Production Supabase changes: NONE
- Production migrations: NONE
- RLS changes: NONE
- Permission contract changes: NONE
- Printing changes: NONE
- POS source changes in this branch: NONE
- Other active development branch changes: NONE
