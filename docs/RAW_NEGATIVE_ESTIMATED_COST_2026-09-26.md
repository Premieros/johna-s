# RAW NEGATIVE ESTIMATED COST — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/raw-negative-estimated-cost-20260926`
Current PR: `#379`
Last updated: 2026-09-26

## Work status
State: **BLOCKED**

## Guardrails
- No direct write to `main`.
- No Production migration before exact-head Full Verify Green + explicit approval.
- No rewrite of physical raw-material quantities, sales, purchases, journals, or historical COGS for an estimated negative valuation.
- Actual FIFO/COGS remains authoritative; negative-stock valuation is explicitly estimated until a real receipt settles the debt.
- Permission-First, branch/warehouse isolation and RLS remain unchanged.
- Printing / Print Agent / routing / KDS / send-to-kitchen presentation are untouched.

## Baseline
- Base: `main@e58705a34f200c5a2fbce2e80b710b180db8300e`.
- Branch was created from that exact main head.
- Production inspection was read-only.
- Confirmed example: raw material `اسبرسو ك` has known historical FIFO cost `1200`, while current negative inventory paths can expose zero-valued oversold batches / inventory average.
- Existing FIFO debt settlement already replaces unresolved negative consumption with the actual later receipt cost and posts the valuation delta through the reconciliation path.

## Root-cause ledger
- `_raw_remove_fifo` creates uncovered negative raw stock as an oversold batch with `unit_cost=0`.
- The matching oversold `inventory_ledger` row is also created at zero cost so that later receipt settlement can post the actual FIFO cost exactly once.
- `raw_material_inventory.avg_cost` is forced to zero when net branch quantity is non-positive, so UI/report readers that rely on current inventory average lose the last known useful valuation price.
- Writing an estimated cost into the oversold ledger before receipt settlement would contaminate actual COGS and cause the later FIFO reconciliation to double-count.
- Therefore estimated negative valuation must remain separate from actual accounting cost.

## Change ledger
- Added forward-only migration `20260926124500_raw_negative_estimated_valuation.sql`.
- Added `_raw_last_known_fifo_cost` to resolve the most recent real FIFO cost in the same raw material + branch + warehouse.
- Added a guarded oversold-batch trigger that assigns the known FIFO price to negative oversold batches for valuation only.
- Existing open zero-cost FIFO debt batches are backfilled with an estimated batch price only; their source ledger/journals are not rewritten.
- Added an inventory-average guard so `raw_material_inventory.avg_cost` is computed from positive physical batches only.
- Added `get_raw_material_cost_valuation_overview` exposing:
  - current net quantity,
  - positive quantity,
  - negative quantity,
  - actual positive-stock value,
  - estimated negative-stock value,
  - estimated net value including negative exposure.
- Costing Center now displays actual value and estimated negative cost as separate columns and exports both.
- Added `get_raw_consumption_cost_breakdown` for period-based shift/day reporting from authoritative `inventory_ledger`.
- The consumption RPC splits actual settled FIFO quantity/cost from unresolved negative quantity/cost, and computes a display-only total.
- Unresolved negative movement uses the last real FIFO price known at or before the movement timestamp; later purchases cannot retroactively become the estimate for an earlier day.
- Live shift closing now reads raw-material cost from this FIFO ledger RPC instead of recipe `default_cost`.
- Shift A4/thermal raw-material sections display actual cost, negative estimate, and displayed total separately.
- Day closing report uses the same authoritative period RPC and shows the same split.
- Frontend API/types and API/schema contract were updated for the new RPCs.
- Added regression coverage preventing shift/day reports from returning to recipe `default_cost` costing.
- Production read-only audit confirmed canonical raw consumption uses `entry_type='kitchen_send'` (10,848 negative rows) plus historical `sale` rows (2,144); an early filter that omitted `kitchen_send` was caught before merge and corrected.
- The period consumption RPC now follows the same canonical `sale/kitchen_send` contract used by the existing raw-material financial report and respects `private.financial_reference_visible`.
- Added integration coverage for: known FIFO 1200 -> oversold estimate 1200 with zero actual oversold ledger COGS -> later purchase 1300 -> actual FIFO settlement at 1300.
- Parallel-work reconciliation: PR #378 (guaranteed receipt/Z command generation) merged into `main@836ddefd7e2d95997ff83e04f595deef16e50b1a`. Its ShiftModal/printing changes were preserved intact by merging that exact main commit into this branch; this costing work does not edit those print-command paths.
- No Production migration has been applied.

## Verification ledger
- Initial Draft PR #379 opened from implementation head `63b487174e338409a962afde0448dc8cfda3803c`.
- First Verify run `36231733014` started before the mandatory active-worklog pointer was updated; its result is not treated as exact-head verification for the final candidate.
- First Verify run `36231733014` was superseded by subsequent implementation work.
- Main advanced through parallel PR #378; reconciled safely in merge commit `31ddce8d2065eccbeb1efa5bd82ad5ef07bead53` with no force push and no print-path rollback.
- Current implementation head before this log update: `2f156458f09ec98587fa7fce1f18b7fe98c8fba7`; PR #379 is mergeable.
- Verify run `36232509959` started for that implementation head; final exact-head verification after this log update remains pending.

## Production gate
- BLOCKED pending exact-head Full Verify Green + explicit approval.
- Production remains unchanged.

## Next action
1. Run exact-head Full Verify on the final documented head.
2. If verification fails, fix only the demonstrated failure and update this ledger.
3. Recheck latest `main`, preserving any parallel print work, and confirm PR mergeability after Green.
4. Stop before merge and before any Production migration pending explicit approval.

## Mandatory update protocol
- Before every repository write, verify expected branch HEAD and latest `main`.
- Any unexpected HEAD or divergence requires STOP_AND_RECONCILE.
- After every code batch, update **Change ledger**.
- After every workflow/test result, update **Verification ledger**.
- Merge and Production migration remain blocked until exact-head Full Verify is Green and explicit approval is recorded.


## Final verification
- Full Verify 2922 GREEN on head dff3ed67421de46a2599577d21f8b791e6b50479.
- verify: success (worklog, Supabase identity, API contract, lint, typecheck, unit, build).
- db: success (canonical migrations, schema, integration, security/RLS).
- browser-smoke: success.
- main rechecked at 836ddefd7e2d95997ff83e04f595deef16e50b1a; PR #379 remains mergeable and Draft.
- Production migration not applied.
- State: READY_FOR_MERGE_APPROVAL.


## Estimated COGS summary card
- Approved behavior: Costing Center overview shows Actual COGS and Estimated COGS including current negative raw-stock exposure side by side.
- Estimated COGS = actual settled COGS + current negative-stock estimated value.
- The difference is displayed explicitly as the negative-stock gap.
- If any negative quantity still has no authoritative price, the UI shows an unpriced-negative warning so the estimate is not presented as complete.
- Current negative exposure follows the latest authoritative raw-material price (purchase, stock count, or manual pricing), so repricing updates the estimate.
- Historical shift/day consumption remains time-scoped and uses prices known at the movement timestamp; historical reports are not rewritten by later pricing.
- Actual COGS/accounting journals remain unchanged by manual pricing or the estimate.
- Added integration coverage proving a -2 quantity estimate moves 40 -> 60 -> 80 -> 100 as authoritative price events move 20 -> 30 -> 40 -> 50.
- Production migration not applied.
- State after implementation: VERIFY_PENDING.
