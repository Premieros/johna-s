# SHIFT ZERO OPENING / NEGATIVE CLOSE / TREASURY DAY-CLOSE RECONCILIATION — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/shift-negative-balance-zero-opening-20260926`
Current PR: `#377`
Last updated: 2026-09-26

## Work status
State: **IN_PROGRESS**

## Guardrails
- Shift opening balance is always zero.
- Shift expected/actual/difference may be negative.
- Branch treasury balance remains cumulative across shifts/days.
- Closing a shift/day must not reset branch treasury.
- Day-close visibility in branch treasury is reconciliation-only; no duplicate accounting entry.
- No printing/KDS/agent changes.
- No direct write to main.
- No Production migration before exact-head Full Verify Green + explicit approval.

## Root-cause ledger
- `shifts_nonnegative_amounts` blocks negative expected/actual shift close values.
- `open_shift` accepts a non-zero opening amount even though the operating model requires every shift drawer to start at zero.
- Shift UI blocks negative actual cash with `min={0}`.
- Branch treasury is cumulative, but day-close rows are not exposed in treasury statements, making reconciliation opaque to users.
- Cleopatra and Smoha manual closes temporarily used carried treasury balance as shift opening; these historical rows must be corrected back to opening=0 and negative shift net values after the model fix is deployed.

## Intended model
- Shift: opening 0 + cash sales + cash in - cash purchases - cash expenses - refunds/cash out = shift net; negative is allowed.
- Branch treasury: cumulative balance across shifts/days; day close does not zero it.
- Treasury statement: accounting movements remain authoritative; day-close rows are displayed as reconciliation markers containing cash/card/day-net and cumulative closing balances, without affecting running balance twice.

## Change ledger
- Replaced the old `shifts_nonnegative_amounts` constraint with opening-only nonnegative protection; expected/actual/difference may be negative.
- `open_shift` now ignores any supplied opening amount and always persists shift opening = 0 plus a zero opening operation.
- Removed frontend minimum-zero restriction from shift close inputs and clearly labels negative shift net as allowed.
- Shifts admin no longer asks the operator to enter an opening balance; it explains that branch treasury is separate.
- Added `get_branch_treasury_day_close_reconciliation(branch, limit)`.
- Reconciliation rows read `daily_closes` for cash/card/credit day totals and read the actual journal ledger for cash/bank closing balances.
- Reconciliation rows are read-only markers: no journal/treasury transaction is inserted.
- `close_shift_with_open_orders` now closes the current shift and atomically opens a zero-opening successor shift when effective open/held orders remain.
- Orders/tables/KDS rows are not mutated or reassigned because orders are branch-level, not shift-owned; later payment resolves against the new active shift through the canonical payment path.
- Treasury page now shows day-close cash sales, bank/card sales, movement since previous close, cash closing balance, bank closing balance, and total branch treasury after close.
- Updated API contract and added unit regression coverage.
- Updated open-order close integration coverage to require a zero-opening successor shift while preserving the exact order/table state.
- Added integration coverage proving a zero-opening shift can close with negative expected/actual values.
- Cleopatra/Smoha historical close correction remains pending until deployment.

## Verification ledger
- Pending.

## Production gate
- BLOCKED pending exact-head Full Verify Green + explicit approval.

## Mandatory update protocol
- Verify branch HEAD before every repository write.
- Any unexpected HEAD or main movement => STOP_AND_RECONCILE.
- Record every behavioral/database change here.
- Production data correction for Cleopatra/Smoha only after code/migration is verified and approved.
