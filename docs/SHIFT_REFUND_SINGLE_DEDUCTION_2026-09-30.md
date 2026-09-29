# SHIFT REFUND SINGLE DEDUCTION - ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/shift-refund-single-deduction-reconciled-20260930`
Current PR: `#414`
Last updated: 2026-09-30

## Work status
State: **BLOCKED**

## Guardrails
- Do not change sale totals, refund records, treasury journal, printing, KDS, or inventory.
- Fix only canonical shift expected-cash calculation.
- A refund linked to a sale already included in the same shift must be deducted exactly once.
- A refund for a sale from another or older shift must still reduce the current shift cash.
- No direct main write, no force push, no Production migration before exact-head Green and explicit approval.

## Baseline
- Base main: `c624c61b18e9a26e48044b5010b55ca045a359db`.
- Production DB: `azzdesuowpdcoflmyezn`.
- Reconciled from latest main after PR #411 merge.
- Cleopatra 2026-09-29 second shift has a 75.00 same-shift cash refund that was deducted twice by the old canonical helper.

## Root-cause ledger
- `private.report_sale_settlement_lines` already subtracts refunds from the sale settlement.
- `public._compute_shift_expected_cash` also subtracted `shift_operations.operation_type='refund'`.
- When the refunded sale is part of the same shift, the same refund was deducted twice.

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
- Exact-head CI pending on reconciled branch.

## Production gate
State: **BLOCKED**
- No Production migration applied.
- No merge until exact-head Fast Verify and Full Verify are Green.

## Next action
1. Open reconciled Draft PR.
2. Run exact-head Fast Verify and Full Verify.
3. Reconfirm no Print/KDS/treasury mutation.
4. Merge only after Green within the approved repair sequence.

## Mandatory update protocol
- Verify HEAD before every repository write.
- Unexpected HEAD movement => STOP_AND_RECONCILE.
- Keep CURRENT_WORK_PLAN pointed to this file while the reconciled PR is active.
- Record exact-head CI results.
- No merge or Production migration before full verification and explicit approval.
