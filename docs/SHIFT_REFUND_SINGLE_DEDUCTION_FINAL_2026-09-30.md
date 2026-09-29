# SHIFT REFUND SINGLE DEDUCTION - FINAL ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/shift-refund-single-deduction-final-20260930`
Current PR: `#415`
Last updated: 2026-09-30

## Work status
State: **BLOCKED**

## Guardrails
- Do not change sale totals, refund records, treasury journal, printing, KDS, or inventory.
- Fix only canonical shift expected-cash calculation.
- Same-shift refunds must be deducted once.
- Refunds for older/different-shift sales must still reduce current shift cash.
- No Production migration before exact-head Green.

## Baseline
- Base main: `af667984d5b6141232f26e4cf6422abff495a4b8`.
- Supplier visibility fix PR #413 is already merged.
- Production DB: `azzdesuowpdcoflmyezn`.

## Root-cause ledger
- `private.report_sale_settlement_lines` already subtracts refunds.
- `public._compute_shift_expected_cash` also subtracted the same `refund` operation.
- Cleopatra 2026-09-29 second shift was understated by 75.00.

## Change ledger
- Migration: `20260930004000_shift_refund_single_deduction.sql`.
- Same-shift refund operations are excluded from secondary subtraction.
- Older/different-shift refunds remain cash outflow.
- Regression test: `tests/unit/shiftRefundSingleDeduction.test.ts`.

## Verification ledger
- Production read-only simulation:
  - old second shift: 4205.94
  - corrected second shift: 4280.94
  - corrected two-shift total: 9462.20
  - branch cash movement before main-treasury transfer: 9462.20
- Exact-head CI pending.

## Production gate
State: **BLOCKED**
- No Production migration applied yet.
- Merge and apply only after exact-head Fast Verify + Full Verify Green.

## Next action
1. Open final reconciled PR.
2. Run exact-head Fast Verify + Full Verify.
3. Merge if Green.
4. Apply migration to Production.
5. Recheck 2026-09-29 shift totals and current branch cash.

## Mandatory update protocol
- Verify HEAD before every repository write.
- Unexpected HEAD movement => STOP_AND_RECONCILE.
- No merge or Production migration before full verification.
