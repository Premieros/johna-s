# CASH HANDOVER SINGLE SOURCE RECONCILIATION — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/cash-handover-single-source-20260929`
Current PR: `#409`
Last updated: 2026-09-29

## Work status
State: **BLOCKED**

## Guardrails
- Employee counted cash is informational only and MUST NOT drive treasury, handover, shift-net, or carry-forward calculations.
- Employee handover amount is the canonical calculated shift cash net from `public._compute_shift_expected_cash(shift_id)`.
- If counted cash is higher or lower than the calculated shift close amount, the calculated shift close amount remains authoritative for accounting; the count difference is shown only as a discrepancy.
- Treasury daily journal must reconcile: cash carried + daily cash net = actual cash closing balance.
- Cash movements outside shifts must be shown explicitly and must not be attributed to the employee.
- Applies to all branches, including Cleopatra and Smouha.
- No printing / Print Agent / routing / KDS changes.
- No direct write to main. No force push.
- No Production migration before exact-head Full Verify Green + explicit approval.

## Baseline
- Base main: `5c74a25448afb65c4e3b528751f749215162cd1b`.
- Existing canonical shift cash calculator already includes cash sales, cash expenses, cash purchases, refunds, cash-in and cash-out.
- Treasury daily journal previously used ledger movement but did not expose shift cash net vs outside-shift cash movement.
- Historical `shifts.expected_amount` may be stale; reconciliation must recalculate rather than trust stale stored values.

## Root-cause ledger
- Treasury and shift reporting exposed different aggregation paths for what users understood as "net cash".
- Counted cash / `actual_amount` was visible near shift-close values and could be mistaken for the accounting handover amount.
- Cleopatra 2026-09-21 canonical shift cash net recalculates to 6478.26, while the treasury ledger includes large branch-level cash movements outside the shift.
- Cleopatra 2026-09-22 canonical shift cash net totals 9896.26, while treasury daily cash movement is 9352.48, leaving -543.78 as outside-shift cash movement.
- Smouha 2026-09-21 and 2026-09-22 reconcile exactly after canonical recalculation.

## Change ledger
- Added Treasury columns: shift cash net, cash outside shifts, daily cash net.
- Treasury daily net is authoritative ledger cash movement.
- Shift cash net is recalculated from `public._compute_shift_expected_cash`, not stored expected/actual/count fields.
- Cash outside shifts = daily cash net - shift cash net.
- Updated Treasury column storage version so existing users see the new financial columns.
- Added regression tests for single-source reconciliation.
- Counted cash remains informational only; no accounting formula uses `actual_amount`.

## Verification ledger
- Fast Verify run 36627103417: in progress at latest check.
- Full Verify run 36627166391: failed only at mandatory active-work-log gate before application/DB/browser verification.
- Production read-only reconciliation:
  - Cleopatra 2026-09-21: shift cash net 6478.26; treasury daily cash net -8158.05; outside-shift cash -14636.31.
  - Cleopatra 2026-09-22: shift cash net 9896.26; treasury daily cash net 9352.48; outside-shift cash -543.78.
  - Smouha 2026-09-21: shift cash net 5141.00; treasury daily cash net 5141.00; outside-shift cash 0.
  - Smouha 2026-09-22: shift cash net 2772.00; treasury daily cash net 2772.00; outside-shift cash 0.

## Production gate
State: **BLOCKED**
- No Production migration applied.
- No merge to main.
- Requires exact-head Fast Verify + Full Verify Green and explicit approval.

## Next action
1. Re-run CI after active work-log correction.
2. Confirm focused cash reconciliation tests Green.
3. Confirm DB integration and Browser Smoke Green.
4. Re-check latest main before any merge decision.
5. Stop for explicit approval before merge and Production migration.

## Mandatory update protocol
- Verify branch HEAD before every repository write.
- Unexpected HEAD movement => STOP_AND_RECONCILE.
- Update this log after every meaningful code/database change.
- Record every verification run and result.
- Keep `docs/CURRENT_WORK_PLAN.md` pointing to this file while PR #409 is active.
- No merge or Production migration until exact-head Full Verify Green + explicit approval.
