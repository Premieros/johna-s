# SHIFT REFUND SINGLE DEDUCTION - ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/shift-refund-single-deduction-20260930`
Current PR: `#412`
Last updated: 2026-09-30

## Work status
State: **BLOCKED**

## Guardrails
- Do not change sale totals, refund records, treasury journal, printing, KDS, or inventory.
- Fix only shift expected-cash calculation.
- A refund linked to a sale already included in the same shift must be deducted exactly once.
- A refund for a sale from another or older shift must still reduce the current shift cash.
- No direct main write, no force push, no Production migration before exact-head Green and explicit approval.

## Baseline
- Base main: `dc2cfe2ada2d495b037fdf48430af501c7a97fa1`.
- Production DB: `azzdesuowpdcoflmyezn`.
- 2026-09-29 Cleopatra has two shifts: closed zico plus open ali-elsayed.
- Branch treasury day includes a transfer-out to main treasury of 17173.90.
- Smouha 2026-09-29 shift total less transfer-out reconciles exactly to treasury day net.

## Root-cause ledger
- `private.report_sale_settlement_lines` already subtracts sale or payment refunds.
- `public._compute_shift_expected_cash` also subtracts `shift_operations.operation_type='refund'`.
- When the refunded sale is part of the same shift, the same cash refund is deducted twice.
- Cleopatra 2026-09-29 second shift had a 75.00 cash refund causing expected cash 4205.94 instead of 4280.94.

## Change ledger
- Added migration `20260930004000_shift_refund_single_deduction.sql`.
- Refund operation is subtracted only when its sale is not in the current shift `sale_ids`.
- Same-shift refunds remain accounted through canonical settlement lines.
- Added regression test `tests/unit/shiftRefundSingleDeduction.test.ts`.

## Verification ledger
- Read-only Production simulation: old second-shift value 4205.94; corrected 4280.94.
- Corrected Cleopatra two-shift total: 9462.20.
- Treasury cash movement before main-treasury transfer: 9462.20.
- No Production mutation has been made for this correction.
- Exact-head CI pending.

## Production gate
State: **BLOCKED**
- No Production migration applied.
- No merge until exact-head Fast Verify and Full Verify are Green and explicit approval is given.

## Next action
1. Run exact-head Fast Verify and Full Verify.
2. Reconfirm main did not move.
3. Verify changed files exclude Print, KDS, and treasury mutation.
4. Stop before merge for explicit approval.

## Mandatory update protocol
- Verify HEAD before every repository write.
- Unexpected HEAD movement => STOP_AND_RECONCILE.
- Keep CURRENT_WORK_PLAN pointed to this file while PR #412 is active.
- Record exact-head CI results.
- No merge or Production migration before full verification and explicit approval.