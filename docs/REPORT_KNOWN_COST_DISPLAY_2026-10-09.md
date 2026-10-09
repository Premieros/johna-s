# REPORT KNOWN COST DISPLAY — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/report-show-known-cost-20261009`
Current PR: #482
Last updated: 2026-10-09

## Work status
State: **IN DEVELOPMENT**. Latest user-approved rule: operational sale cost is quantity × latest approved raw-material price frozen at Send to Kitchen. FIFO must not be invoked by sales-cost reports. Await exact-head CI and separate explicit approval to apply new production trigger migration.

## Guardrails
- Do not change saved material prices, FIFO layers, stock or financial journals.
- Preserve the distinction between full known cost, partially priced components and actual posted COGS.
- Do not show a calculated actual profit for a partial cost.
- Preserve branch permissions and RLS.

## Baseline
The reporting projection printed 'غير مكتملة' when some components lacked prices, even though the priced-components portion was already calculated and available.

## Change ledger
- 2026-10-09: Diagnosed exact-head Verify main failure: mandatory active worklog contract requires this heading; corrected documentation only. No SQL or operational data changes.

## Root-cause ledger
- The display used estimatedCost as the only source for the current-price cost column.
- knownEstimatedCost was calculated separately but not used as the visible fallback.

## Approved final scope — 2026-10-09
- At Send to Kitchen: capture the quantity and latest approved positive material price for each consumed ingredient into the existing component_snapshot. Existing kitchen stock/FIFO deduction and accounting journals remain unchanged.
- A material with no positive saved price stays NULL, never zero or an invented FIFO/default price.
- Report sales costs use the frozen snapshot exclusively. No price query, inventory_ledger join, or FIFO reconciliation on report reads, Excel or CSV export.
- Previous sales without saved unit-cost snapshots are legacy/unpriced and are never repriced from today's prices.
- Partial known ingredient amounts remain visible, with clear unpriced-material names; complete gross profit appears only when every ingredient is priced.
- Voids and refunds prorate the frozen event quantity/cost. Branch isolation and existing financial read permissions remain.
- The new SQL trigger migration is a **production function/schema change**, NOT read-only, and must never run on live without a separate explicit approval after green CI.

## Changes prepared on PR #482
- Report UI: remove the obsolete opt-in FIFO button and all unsupported costMode arguments; label source as sale-time saved price.
- Report reader: use kitchen snapshots, no inventory_ledger or current-price scan.
- Schema contract: remove inventory_ledger from the frontend reads after eliminating its last use.
- Tests: replace obsolete FIFO scenarios with immutable priced/partially priced/unpriced/legacy/void/refund cases.
- Excel source note: explain saved dispatch costs and absence of FIFO from sales reporting.

## Verification ledger
- 2026-10-09: Verify main run 37934441578: worklog, API contract, lint and typechecks passed; unit suite had 1 failed / 1674 passed because rawMaterialPriceReaderConsistency still required a live current-price reader in the snapshot-only station report. Updated contract test to explicitly require immutable component_snapshot and prohibit both current-price readers. Database, browser and build remained skipped; rerun required on latest SHA. No production changes.
- Exact-head Fast Verify and Verify main must rerun on the new PR head, including stationSalesReport tests and reports-stability component tests.
- Live account browser performance/permissions remain to be validated separately; no claim of measured speedup.

## Production gate
State: **BLOCKED** until green CI; the new trigger migration DOES require separate production SQL approval. No live changes applied.

## Mandatory update protocol
- Recheck main and exact HEAD before merging.
- No merge while checks are pending or failing.
- Do not apply production SQL.

## Next action
Pass exact-head Fast Verify, Full Verify, database and browser tests; inspect migration/security and run a real (non-destructive) report check. Stop before merge and new production SQL application for explicit final authorization. Never silently deploy.
