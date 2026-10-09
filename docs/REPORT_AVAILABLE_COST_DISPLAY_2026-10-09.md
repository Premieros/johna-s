# REPORT AVAILABLE COST DISPLAY — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/report-available-cost-display-20261009`
Current PR: #480

## Work status
State: IN VERIFICATION. No production SQL change.

## Guardrails
- Do not synthesize posted inventory cost from estimates.
- Preserve branch permissions and financial visibility.
- Distinguish posted costs, fully priced estimates, and priced-components-only estimates.
- Never present estimated gross profit as realized accounting gross profit.
- No change to stock, sales, accounting postings or FIFO debt.

## Baseline
Sales-by-station and sales-cost reports displayed incomplete or unavailable placeholders even when known estimated component costs existed. User requested the available cost instead.

## Change ledger
- Added an Available Cost column showing posted cost first, otherwise complete current-price estimate, otherwise priced-components-only estimate.
- Added Cost Source indicating which type of cost is displayed.
- Retained the separate Recorded Cost and recorded gross profit fields; unknown posted cost is shown as a dash rather than an invented figure.
- Replaced incomplete placeholders in station-cost projections with available priced values or a dash.

## Verification ledger
- Initial Full Verify failed the mandatory work-log branch gate only.
- Updated active work plan and opened this mandatory log.
- Fresh exact-head Full Verify pending.

## Next action
Complete exact-head Full Verify and review browser output before merging PR #480. Production pricing/FIFO remediation remains a separate investigation.
