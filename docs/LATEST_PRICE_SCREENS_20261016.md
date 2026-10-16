# Latest-price screens and loading — active work log
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/latest-price-screens-load-20261016`
Current PR: `#514`
Last updated: 2026-10-16 Cairo

## Work status
State: **BLOCKED**
Draft PR#514. User requests consistent latest-price displays and less loading.

## Guardrails
One writer; only this repository/database. Frontend-only. Preserve current prices,
historical snapshots, FIFO/accounting writers, RLS, stock, sale and print contracts.
No real purchases/sales/prints. No production merge/deployment before review approval.

## Baseline
Main c6f625820d1fa44b95424332a962e1c665109327, #513 applied and deployed.
Live samples: Smouha egg3.60 matches raw catalog, new purchase and recipe;
Cleopatra egg4.33 matches raw catalog/new purchase. Classic Omelate28.34 matches recipe.

## Root-cause ledger
Raw-material metadata loads all batches/inventory even on the prices tab and blocks
unit/branch/price display on those reads. Costing raw-prices requests full stock
valuation and an extra FIFO inventory read before latest prices. Overview also
waits for unrelated raw stock valuation. The shared price reader makes five
sequential100-row RPCs for a403-material branch despite the indexed reader.

## Change ledger
Compact current-price displays in Costing Center and Reports share one reader.
Full existing FIFO/debt valuation remains available only in its explicit report/tab.
Raw-material inventory/batches load only for their selected tab and branch.
Indexed price requests use bounded500-row batches:403 materials now use one RPC,
not five. Overview omits unrelated stock valuation.
Use clear recorded accounting cost labels. Historical reports keep as-of snapshots.

## Verification ledger
83 targeted component/service/smoke tests passed, including zero valuation reads
for current prices, retained manual report gates and separate valuation behavior.
Full local application suite passed:1802 tests/371 files. Application/test typechecks,
lint0errors/13existing warnings and production build passed. Exact-head CI pending.
Local Playwright hit environment network-interface and missing browser-binary limits;
GitHub verification e4f2d39 passed1081 DB/1802 app tests; browser133 passed and
one price-budget test retried because it included the shared quantity-only stock
notifier in its valuation budget. Classify actual valuation/metadata and batch
reads precisely; the separate notification quantity read remains unchanged.
Fresh final-head browser verification remains mandatory. Tests use stable toast mocks matching
the real provider; no runtime permission or accounting behavior was weakened.

## Production gate
Frontend release blocked pending exact-head checks and owner review approval.
No SQL migration. Rollback is previous frontend build; #513 DB remains compatible.

## Next action
Implement and verify; publish one draft PR with exact evidence and ask before merge.

## Mandatory update protocol
Verify main and repo identity; keep one writer; record all outcomes and next step.
