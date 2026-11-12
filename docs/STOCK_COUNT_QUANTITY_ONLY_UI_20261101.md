# Quantity-only stock count UI — 2026-11-01
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/stock-count-quantity-only-ui-20261101`
Current PR: #574
Last updated: 2026-11-01
State: **BLOCKED** pending exact-head CI

## Work status
Separates price-free stock count UI and Excel changes from the financial implementation in PR #571.

## Guardrails
No mutation of production stock, financial ledgers, count statuses or permissions. Keep historical count prices only for audit; do not expose manually editable price. Do not merge cost engine candidate.

## Baseline
Main has atomic stock count application from PR #570. Approved-price financial integration is not production ready.

## Root-cause ledger
The stock count form exposed an optional manual unit cost and Excel accepted arbitrary values, inconsistent with the owner's rule to use existing approved prices.

## Change ledger
Removed manual cost input, export column and legacy workbook pricing imports; hid unreliable draft cost valuation. Added quantity-only Excel regression.

## Verification ledger
Previous #574 run 4639: db/browser/pages succeeded, verify failed on worklog branch metadata. This update corrects that metadata; current-head CI must pass.

## Production gate
UI-only release may merge after full exact-head CI. PR #571 must remain blocked until approved price, raw movement and historical debts are reconciled. No automatic application of draft counts 00008/00009.

## Next action
Verify exact-head CI and merge UI-only PR after all four jobs succeed.

## Mandatory update protocol
Record material tests and deployments without overstating completed financial release.
