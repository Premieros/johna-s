# PURCHASE RETURN LINK + MAIN TREASURY MOVEMENT - ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/main-treasury-movement-prod-safety-20260930`
Current PR: `#417`
Last updated: 2026-09-30

## Work status
State: **BLOCKED**

## Guardrails
- No direct write to main.
- No force push.
- No inventory mutation.
- No purchase/supplier amount rewrite.
- No duplicate financial posting for historical purchase returns.
- Main treasury balance remains journal-derived; treasury_transactions is audit/display only.
- No printing/KDS/shift behavior changes.
- No Production migration before exact-head Fast Verify + Full Verify Green and merge approval.

## Baseline
- Base main: `26193f0c7866367c7d55419bd94030de6baf23bb`.
- Production DB: `azzdesuowpdcoflmyezn`.

## Root-cause ledger
### Purchase return references
- Initial UUID-only audit falsely flagged historical return journals as missing.
- Legacy `process_purchase_return` posts `purchase_return` with `reference_id = NULL` and the original invoice number.
- Financial return journals are present; no new accounting reversal is required.
- Production currently has 52 purchase_return journals with NULL reference_id:
  - 20 uniquely linkable to one purchase.
  - 14 unmatched.
  - 18 ambiguous.
- Only uniquely linkable rows may be backfilled.

### Main treasury expense movement visibility
- Cross-branch expense payment from organization/main treasury correctly posts:
  - expense journal in the expense branch;
  - `expense_funding` journal in the main treasury branch.
- Treasury balance is therefore correct.
- TreasuryPage movement feed reads only `treasury_transactions`.
- Production has 7 Cleopatra main-treasury expense funding entries totaling 66,330.00 with no treasury_transactions audit rows, so the movements are invisible in Main Treasury history.

## Change ledger
- Add purchase-return reference linker:
  - future purchase_return journals are linked to purchase UUID only on a unique match;
  - historical NULL references are backfilled only when exactly one purchase matches;
  - no financial amount or inventory changes.
- Add main treasury expense movement audit synchronization:
  - `expense_funding` credit to organization treasury => withdrawal audit row;
  - `expense_funding_reversal` debit => deposit audit row;
  - no journal posting is created by this sync.
- Backfill existing missing expense funding movement audit rows idempotently.
- TreasuryPage movement table adds a Details/البيان column to show branch and expense description.

## Verification ledger
- System-health audit remains green for both branches: no duplicate open shifts, table/order mismatch, unbalanced journals, sale-payment detail mismatch, refund integrity violation, live kitchen inventory mismatch, or stale print jobs.
- Main treasury missing movement audit rows confirmed: 7 rows / 66,330.00, all for Cleopatra expense funding.
- Exact-head CI pending.

## Production gate
State: **PRODUCTION SAFETY HOTFIX ACTIVE**
- No Production migration applied.
- No merge before exact-head Fast Verify + Full Verify Green.

## Next action
1. Open Draft PR.
2. Run exact-head Fast Verify + Full Verify.
3. Verify migration on clean test DB and regression tests.
4. Recheck main movement backfill count and purchase-return unique-link count.
5. Stop before merge unless explicitly approved.

## Mandatory update protocol
- Verify HEAD before each repository write.
- Unexpected HEAD movement => STOP_AND_RECONCILE.
- Keep CURRENT_WORK_PLAN pointed to this log while active.
- Record exact-head CI results.


## Production safety correction
- PR #417 merged to main at `b604decb34c97aa510c390e87b39ce76ff18c080`.
- First Production migration attempt was fully rolled back by PostgreSQL due `uq_journal_reference` duplicate-key protection while trying to link purchase-return journals.
- No Production data from that migration attempt was committed.
- Root cause: a purchase can have multiple purchase_return journals, while `(reference_type, reference_id)` is unique; therefore forcing every return journal to the same purchase UUID is invalid.
- Corrective decision: remove all purchase-return reference rewrites/backfills from this migration. Financial purchase-return journals are already present and correct; they remain untouched.
- Keep only main-treasury expense movement audit visibility and UI details column.
- Corrective branch: `development/main-treasury-movement-prod-safety-20260930`.
- Production remains unchanged until corrective exact-head CI is Green and the corrective PR is merged.


## Production safety correction
- PR #417 merged to main at `b604decb34c97aa510c390e87b39ce76ff18c080`.
- First Production migration attempt was fully rolled back by PostgreSQL due `uq_journal_reference` duplicate-key protection while trying to link purchase-return journals.
- No Production data from that migration attempt was committed.
- Root cause: a purchase can have multiple purchase_return journals, while `(reference_type, reference_id)` is unique; therefore forcing every return journal to the same purchase UUID is invalid.
- Corrective decision: remove all purchase-return reference rewrites/backfills from this migration. Financial purchase-return journals are already present and correct; they remain untouched.
- Keep only main-treasury expense movement audit visibility and UI details column.
- Corrective branch: `development/main-treasury-movement-prod-safety-20260930`.
- Production remains unchanged until corrective exact-head CI is Green and the corrective PR is merged.
