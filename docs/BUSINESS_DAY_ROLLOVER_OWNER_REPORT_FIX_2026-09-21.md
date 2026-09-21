# Business Day Rollover + Shift Owner Reporting Fix — 2026-09-21

## Scope
Production defects verified before implementation:

1. A closed `daily_closes` snapshot for the same calendar date could hide the currently open workday. In Cleopatra this caused the live day report to show purchases from the previous closed period and omit purchases from the active shift period.
2. `get_shift_closing_report` attributed sale rows to `shift_operations.created_by` (the payment collector) instead of the order/table owner stored in `sales.cashier_id`.

## Required behavior
- Closing a **business day** must not require closing the active branch shift.
- A rollover freezes the current day snapshot, advances to a new business-day identity and keeps the exact same shift open.
- Open orders/tables are untouched.
- New sales, expenses and purchases after the rollover boundary belong only to the new day.
- Historical snapshots stay immutable.
- Shift/user sales are attributed to the order/table owner (`sales.cashier_id`).
- The payment collector remains in `shift_operations.created_by` for audit and cash-operation traceability.
- Printing contracts and the frozen Windows print agent are not changed.

## Implementation
Branch: `development/business-day-rollover-owner-fix`

Migration:
- `supabase/migrations/20260921233000_business_day_rollover_owner_reporting.sql`
- Adds internal `business_day_state` keyed by branch.
- Adds `get_current_business_day(uuid)`.
- Adds `rollover_business_day(uuid)`.
- `day_close` now performs a rollover when a shift is open; ordinary final close remains available when no shift is open.
- `_resolve_business_day_window` uses the persisted active boundary for the live workday.
- A shift spanning a rollover remains visible in every day report whose window it overlaps.
- `get_shift_closing_report` uses `sales.cashier_id` for sale ownership.

Frontend:
- Shift page resolves the authoritative current business date from the server.
- Day-close modal explicitly states that the same shift and open orders continue.
- After rollover, the just-closed snapshot is printed and the UI moves to the next business date.

## Safety / rollback
- No direct writes to `main`.
- No print-agent/RPC queue contract changes.
- No order, table, sale or shift IDs are rewritten by rollover.
- Existing `daily_closes.report_snapshot` rows are not modified.
- Production migration is blocked until Full Verify is green and explicit user approval exists.
- Rollback point before Production is the current `main` head recorded at branch creation: `d1ceb83acded33cde594706bae708df3a4a8ed8e`.

## Verification required before Production
- frontend API contract
- lint
- TypeScript
- unit tests
- build
- fresh DB migrations + schema checks
- integration/security/RLS suite
- browser smoke if the workflow reaches it

## Focused regression coverage
- `tests/unit/businessDayRolloverOwnerReportContract.test.ts`
- `tests/integration/business_day_rollover_owner_reporting.test.ts`

Production verification after migration must confirm:
- Cleopatra current business day starts at the active shift boundary after the prior snapshot.
- purchases before that boundary are absent; purchases after it are present.
- the active shift ID remains unchanged.
- user totals in the shift report follow sale/order ownership, not the person who collected payment.
