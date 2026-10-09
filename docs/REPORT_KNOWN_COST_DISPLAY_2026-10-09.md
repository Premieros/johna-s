# REPORT KNOWN COST DISPLAY — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/report-show-known-cost-20261009`
Current PR: #482
Last updated: 2026-10-09

## Work status
State: **BLOCKED** until green exact-head verification.

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

## Change ledger
- Use complete current-price cost when present, otherwise the already-computed priced-components-only cost; show dash if no cost amount is available.
- Keep explicit priced-components column and unpriced-material indicators.

## Verification ledger
- Exact-head Fast Verify and Verify main pending.

## Production gate
State: **BLOCKED** until green CI. No production SQL or financial write is required.

## Mandatory update protocol
- Recheck main and exact HEAD before merging.
- No merge while checks are pending or failing.
- Do not apply production SQL.

## Next action
Pass full Verify and browser tests, then merge PR #482 and confirm deployment.
