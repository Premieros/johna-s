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
- Frontend API/types and API/schema contract were updated for the new RPC.
- Added integration coverage for: known FIFO 1200 -> oversold estimate 1200 with zero actual oversold ledger COGS -> later purchase 1300 -> actual FIFO settlement at 1300.
- No Production migration has been applied.

## Verification ledger
- Initial Draft PR #379 opened from implementation head `63b487174e338409a962afde0448dc8cfda3803c`.
- First Verify run `36231733014` started before the mandatory active-worklog pointer was updated; its result is not treated as exact-head verification for the final candidate.
- Focused/full exact-head verification after this log and unified-plan pointer update: pending.

## Production gate
- BLOCKED pending exact-head Full Verify Green + explicit approval.
- Production remains unchanged.

## Next action
1. Point `docs/CURRENT_WORK_PLAN.md` mandatory execution gate to this log, branch and PR #379.
2. Run exact-head Full Verify.
3. If verification fails, fix only the demonstrated failure and update this ledger.
4. Recheck latest `main` and PR mergeability after Green.
5. Stop before merge and before any Production migration pending explicit approval.

## Mandatory update protocol
- Before every repository write, verify expected branch HEAD and latest `main`.
- Any unexpected HEAD or divergence requires STOP_AND_RECONCILE.
- After every code batch, update **Change ledger**.
- After every workflow/test result, update **Verification ledger**.
- Merge and Production migration remain blocked until exact-head Full Verify is Green and explicit approval is recorded.
