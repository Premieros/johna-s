# REPORT KNOWN COST DISPLAY — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/report-show-known-cost-20261009`
Current PR: #482
Last updated: 2026-10-09

## Work status
State: **IN DEVELOPMENT**. User requested a faster estimated-sales report with FIFO actual cost only on explicit click. Await exact-head CI.

## Guardrails
- Do not change saved material prices, FIFO layers, stock or financial journals.
- Preserve the distinction between full known cost, partially priced components and actual posted COGS.
- Do not show a calculated actual profit for a partial cost.
- Preserve branch permissions and RLS.

## Baseline
The reporting projection printed 'غير مكتملة' when some components lacked prices, even though the priced-components portion was already calculated and available.

## Root-cause ledger
- The display used estimatedCost as the only source for the current-price cost column.
- knownEstimatedCost was calculated separately but not used as the visible fallback.

## New scope — 2026-10-09 user direction
- Open sales-cost and station-cost reports in **estimated** mode by default.
- Formula: saved component quantity × canonical displayed price (positive current FIFO unit cost, else last positive saved price). Clearly labeled estimate; missing material price is blank, never zero.
- Do not query inventory_ledger unless a user with reports.costing permission explicitly clicks Calculate actual cost (FIFO).
- Keep recorded FIFO cost and recorded gross profit off the default estimated view. Button toggles to actual mode. Re-running the report resets to estimate.
- Report reads and CSV/Excel exports use the same selected mode; no alteration to accounting, historic movements, saved prices, branch/RLS policies.
- Add unit and UI tests. Avoid broad changes in financial reports/posted COGS, which have separate accounting meaning.

## Change ledger
- Use complete current-price cost when present, otherwise the already-computed priced-components-only cost; show dash if no cost amount is available.
- Keep explicit priced-components column and unpriced-material indicators.

## Verification ledger
- Exact-head Fast Verify and Verify main must rerun on the new PR head, including stationSalesReport tests and reports-stability component tests.
- Live account browser performance/permissions remain to be validated separately; no claim of measured speedup.

## Production gate
State: **BLOCKED** until green CI. No production SQL or financial write is required.

## Mandatory update protocol
- Recheck main and exact HEAD before merging.
- No merge while checks are pending or failing.
- Do not apply production SQL.

## Next action
Pass full Verify and browser tests on the exact head; request authorization to merge/publish PR #482, then validate a real report. Do not silently deploy.
