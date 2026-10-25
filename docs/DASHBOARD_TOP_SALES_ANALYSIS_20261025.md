# Dashboard top sales analysis — 2026-10-25
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `feat/dashboard-top-sales-analysis-20261025`
Current PR: #538
Last updated: 2026-10-25

## Work status
State: **BLOCKED**
Owner requests replacing the black strip shown in the screenshot with sales analysis. Prepare and verify before production release.

## Guardrails
Frontend only. Preserve permissions, branch/period scopes, sale/printing/stock/accounting writers and installed agents. No production log scans, transactions or database changes.

## Baseline
Main `48b0644bc6f757f019ee8d45d6201586c7a7e74d` (#537 released).

## Root-cause ledger
The welcome/calendar/activity strip occupies the dashboard's most prominent position while the existing sales chart is below the cards.

## Change ledger
Delete the strip and its unused animation CSS. Replace it with a themed sales analysis card containing net sales, invoice count, average invoice and the existing chart. Reuse existing snapshot, permission, branch/date filters and loading/error/empty states; render one chart only. Remove the strip's activity subscription by removing the component. Keep audit access in its separate shortcut.

## Verification ledger
25 focused dashboard/period/contrast/performance cases and 9 dashboard component cases passed, including one existing snapshot read and no sales analysis for unauthorized users. App/test typechecks passed. Exact-head CI pending; no new data requests.

## Production gate
No merge/publication until checks pass and final release approval. Rollback is a normal UI revert; no database rollback.

## Next action
Verify the dashboard and publish one review candidate.

## Mandatory update protocol
Keep one writer and preserve the deployed permission repair. Record exact-head results and release evidence in the PR ledger without changing the tested head for status-only updates.
