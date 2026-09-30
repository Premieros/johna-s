# Smouha Business Day Historical Reconciliation Plan — 2026-09-30

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Scope: historical reconciliation only for Smouha branch `19c3fd23-d784-455b-8840-f4f2ac619651`.
Status: **PREPARED ONLY — DO NOT EXECUTE WHILE LIVE SHIFT/OPEN ORDERS EXIST**

## Confirmed facts
- Production code guard is already applied and prevents repeated manual future rollover.
- Stored Smouha state is 2026-10-03 while current max reachable date is 2026-09-30.
- Future close rows exist for 2026-09-30, 2026-10-01 and 2026-10-02.
- 2026-10-01 snapshot contains 19 invoices / 5,885 net sales and exactly matches the second 2026-09-29 shift.
- Correct 2026-09-29 source activity is 29 completed sales / 9,189 total, 4 purchases / 8,648, and 9 non-voided expenses / 25,799.99.
- 2026-09-30 and 2026-10-02 future snapshots are zero-sales snapshots.
- Audit log identifies two manual rollover actions during the same 2026-09-29 shift:
  - George at 23:16:41Z closed 2026-10-01 and advanced to 2026-10-02.
  - Eslam at 23:17:20Z closed 2026-10-02 and advanced to 2026-10-03.

## Non-negotiable safety gates
1. No execution while Smouha has any open shift.
2. No execution while Smouha has open/held operational orders.
3. Take a read-only before-snapshot of:
   - business_day_state
   - daily_closes rows 2026-09-28 through 2026-10-03
   - shifts spanning 2026-09-29 through current
   - sales / sale_payments
   - purchases
   - expenses
   - treasury reconciliation outputs
   - audit_log rollover rows
4. Historical invalid snapshots must be preserved in an audit-safe backup table or exported artifact before any row mutation.
5. Never rewrite sales, orders, purchases, expenses, payments, inventory, journals, shift cash, print/KDS data, or cashier ownership.
6. Rebuild any corrected daily-close snapshot from canonical source tables/functions after state/history is reconciled; never copy the 2026-10-01 snapshot into 2026-09-29.
7. Reconciliation must be one transaction with explicit validation and rollback on any mismatch.
8. After correction, validate treasury/day-close/shift parity before allowing normal operation.

## Intended repair sequence
1. Enter a maintenance point after current Smouha shift is safely closed and no open/held orders remain.
2. Capture before-state and preserve the invalid future daily-close rows.
3. Reconcile the valid close history:
   - restore 2026-09-29 as a real close rebuilt from canonical source activity;
   - remove only the invalid future-close rows after preservation;
   - do not alter unrelated historical days.
4. Set business_day_state to the real reachable business date with a valid started_at boundary.
5. Rebuild/verify the corrected 2026-09-29 close snapshot.
6. Validate:
   - 29 completed sales / 9,189 source total for 2026-09-29 source span;
   - purchase and expense source totals remain unchanged;
   - no sales/payment/order row count changes;
   - no shift monetary fields change;
   - treasury ending balances remain explainable from canonical movements;
   - current live day is not duplicated or skipped.
7. Commit only if every assertion passes; otherwise rollback.
8. Run post-repair read-only verification and record exact before/after values.

## Explicitly excluded
- No code changes in this repair.
- No POS/print/KDS changes.
- No payment_status mass updates.
- No treasury formula changes.
- No inventory correction.
- No correction for Cleopatra.
- No Phase 2 completed/unpaid work in the same transaction.
