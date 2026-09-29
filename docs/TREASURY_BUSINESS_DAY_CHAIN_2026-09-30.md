# TREASURY BUSINESS-DAY CHAIN RECONCILIATION — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/treasury-business-day-reconciliation-20260929`
Current PR: `#410`
Last updated: 2026-09-30

## Work status
State: **BLOCKED**

## Guardrails
- Employee handover equals canonical calculated shift cash net only.
- Counted cash is informational only and never changes treasury, carry-forward, or employee liability.
- Business-day boundaries come from branch settings and must be shared by shifts and treasury.
- Opening cash + daily cash net = closing cash.
- Closing cash of day N = opening cash of day N+1.
- Latest calculated closing cash must reconcile to actual branch treasury cash.
- Purchases and expenses already included in shift net must never be deducted twice.
- No financial history rewrite.
- No Print / Print Agent / KDS / routing changes.
- No direct main write, no force push, no Production migration before exact-head Green + explicit approval.

## Baseline
- Base main: `f2c82408ca6e3fe5c344dfe5c39bd2a182a99f84`.
- Production database remains `azzdesuowpdcoflmyezn`.
- Cleopatra business-day start is 08:00 and end is 02:30.
- Smouha business-day start is 08:00 and end is 03:00.

## Root-cause ledger
- Treasury daily reconciliation grouped movements by calendar date.
- Operational shifts/business days continue after midnight.
- This created artificial differences between shift net and treasury day net.
- Cleopatra 2026-09-22 artificial difference of 543.78 disappears when both sources use the configured business day.
- Cleopatra 2026-09-21 contains real pre-shift purchases/expenses; these must not be attributed to the employee.
- The 527.20 purchase inside the 2026-09-21 shift is already included in shift cash net 6478.26 and must not be deducted again.

## Change ledger
- Added migration `20260930001000_treasury_business_day_chain_reconciliation.sql`.
- Treasury daily reconciliation now buckets sales, purchases, shifts, journal movements, and transfers by configured business-day start.
- Removed misleading UI column `cash_outside_shifts` / "حركات نقدية خارج الشفتات".
- Treasury explanatory copy now states the carry-forward chain.
- Added unit regression coverage for configured business-day bucketing and carry-forward.
- No Production data mutation has been made by this corrective branch.

## Verification ledger
- Read-only production rebucketing:
  - Cleopatra 2026-09-22: shift cash net = treasury daily cash net = 9896.26; difference 0.00.
  - Cleopatra 2026-09-23: shift cash net = treasury daily cash net = 7360.34; difference 0.00.
  - Cleopatra 2026-09-21: real historical pre-shift activity remains and is not employee liability.
- Full Verify run 36631681882 failed only at mandatory active work-log structure before app/DB/browser checks.
- Fast Verify run 36631640101 is pending at latest check.

## Production gate
State: **BLOCKED**
- No corrective Production migration has been applied.
- PR #410 remains Draft.
- No merge to main until exact-head Fast Verify and Full Verify are Green and explicit approval is given.

## Next action
1. Re-run CI after correcting mandatory active-work-log structure.
2. Verify app, DB integration, and Browser Smoke on the exact head.
3. Validate carry-forward chain for Cleopatra and Smouha.
4. Confirm latest closing cash reaches current branch treasury cash.
5. Stop before merge/Production for explicit approval.

## Mandatory update protocol
- Verify branch HEAD before every repository write.
- Unexpected HEAD movement => STOP_AND_RECONCILE.
- Update this log after every meaningful code/database change.
- Record every verification run and result.
- Keep `docs/CURRENT_WORK_PLAN.md` pointing to this file while PR #410 is active.
- No merge or Production migration until exact-head Full Verify Green + explicit approval.
