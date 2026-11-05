# Period close balances and detailed evidence
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/period-close-balances-details-20261105`
Current PR: `0`
Last updated: 2026-11-05
State: **READY**

## Work status
Implementing owner-approved read-only period-close correction and lazy per-line details.

## Guardrails
No stock count application, business writes, historical accounting replay, FIFO valuation, sales/kitchen/printing changes or new price source. Canonical latest approved zero is valid. Retain financial visibility and branch/history permissions.

## Baseline
Main095bdf9. Existing report requires full applied counts on both boundary days. Screenshots compare Oct1-Nov30 with Oct1-Oct31, so their sales totals are not comparable. Oct1 counts00006/00007 are approved, not applied;00005 rejected. Do not automatically apply them.

## Root-cause ledger
Boundary-day count snapshots were incorrectly used as balances; stock-count historical reconstruction already derives physical balances from the effective-dated inventory ledger. Missing a new end-day count must not hide stock balance.

## Change ledger
Implemented. Use the canonical physical movement history and canonical batch price resolver, start-inclusive/end-exclusive Cairo dates. Net recipe consumption remains separate from count adjustments. Per-line evidence is loaded on demand. Full Excel includes seven worksheets, all pages inside the shared export row budget. Rollback: docs/sql/period_close_balances_details_rollback.sql after frontend revert.

## Verification ledger
Focused frontend5 cases plus cache20 cases passed. Disposable PostgreSQL6 cases cover Cairo cutoffs, unapplied/applied midday counts, latest/zero price, paginated evidence parity, branch/permission/date rejection and masking unreadable document references. Focused typecheck/lint passed; exact-head CI remains required before release. Final read-only EXPLAIN on actual October Smouha data:1761.407ms execution,43.88ms planning,0 physical shared reads and0 temporary read blocks (warm-cache observation, not a whole-system benchmark).
Production read-only audit:581 material/branch coordinates have0 differences between signed physical batches and complete ledger quantities. A draft per-movement financial visibility scan timed out at3s; it was discarded before deployment. Filtering physical balances by readable invoice existence would also drop valid physical movement; the final summary uses complete branch-scoped physical history, like the existing count reconstruction and raw purchase/transfer report. Document-reference visibility is checked only on the requested evidence page, never while aggregating balances. Original invoice amounts/IDs are not exposed.

## Production gate
Owner authorized implementation and existing release scope. No merge/application before successful exact-head checks and review of read-only migration. Verify Pages and read-only production reconciliation; no synthetic restaurant transactions.

## Next action
Implement, test and reconcile summary/detail quantities and values. Record actual release status; do not claim unpublished work is deployed.

## Mandatory update protocol
Update this log at each verification/release checkpoint; record failures and concrete evidence. Preserve other active changes and main-head compare-and-swap.
