# Period close balances and detailed evidence
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `docs/period-close-release-evidence-20261105`
Current PR: `612`
Last updated: 2026-11-05
State: **DEPLOYED**

## Work status
#612 merged as991be8bf5fe25dccecdee89a0b48ef42f8f102e0. Production migration20261105203729 applied successfully. Both branches reconciled in authenticated read-only checks. Published source784994c6af9f187304a606458bed7ecb4519e5a9 includes all report fixes plus concurrent support documentation; no report change was lost. Main42105877801 and Pages42106547904 (build, production-parity and deploy) succeeded. This follow-up records release evidence only and must not republish the application.

## Guardrails
No stock count application, business writes, historical accounting replay, FIFO valuation, sales/kitchen/printing changes or new price source. Canonical latest approved zero is valid. Retain financial visibility and branch/history permissions.

## Baseline
Main095bdf9. Existing report requires full applied counts on both boundary days. Screenshots compare Oct1-Nov30 with Oct1-Oct31, so their sales totals are not comparable. Oct1 counts00006/00007 are approved, not applied;00005 rejected. Do not automatically apply them.

## Root-cause ledger
Boundary-day count snapshots were incorrectly used as balances; stock-count historical reconstruction already derives physical balances from the effective-dated inventory ledger. Missing a new end-day count must not hide stock balance.

## Change ledger
Implemented. Use the canonical physical movement history and canonical batch price resolver, start-inclusive/end-exclusive Cairo dates. Net recipe consumption remains separate from count adjustments. Owner additionally requested net after credit: show net sales including credit, outstanding invoice credit, and net collected from the same existing sales metrics response (no extra query). Invoice details/Excel include collected and outstanding columns; profit remains accrual sales minus consumption/expenses, never cash minus costs. Per-line evidence is loaded on demand. Full Excel includes six worksheets within the shared5000-row budget. Complete movement-detail Excel is fetched separately only for the opened item/category; never pull the entire37734-row physical ledger into every month export. Rollback: docs/sql/period_close_balances_details_rollback.sql after frontend revert.

## Verification ledger
- Focused frontend7 cases plus cache20 cases passed; disposable PostgreSQL6 cases passed. Cairo boundaries, single-day periods, unapplied/applied midday counts, canonical latest/zero price, summary/detail totals, full paginated exports, net after credit, permissions and masked unreadable document references are covered.
- Exact PR heada92fdee95158981e733ee05436363ba20ac8f88c:42104301744, all jobs passed. Final published-source main42105877801:413 frontend files /2069 tests passed in114.39s, both browser shards and aggregate passed, DB and asset continuity passed. No existing tests were removed.
- Production migration20261105203729 changes read-only report functions only. Smouha286 and Cleopatra281 report materials reconcile opening + purchases + transfers + count adjustments + other actual movements = closing. Purchase evidence totals equal raw purchase summary in both branches.
- Production stock audit:581 material/branch coordinates have0 differences between signed physical batches and complete ledger quantities. Historical stock is complete physical history, as used by historical count reconstruction; readable-invoice existence must not remove physical movement. Only document references on the requested evidence page invoke financial visibility; hidden invoice amounts/IDs are not returned.
- Same-period October Smouha:Net Sales404630.60 = payment distribution404630.60; outstanding invoice credit14439.50; net collected390191.10. Credit remains in accrual sales/profit, not a second expense. No additional metrics query.
- Final read-only October query EXPLAIN:1761.407ms execution,43.88ms planning,0 physical shared reads and0 temporary reads (warm-cache observation, not a whole-system benchmark). A draft per-movement financial check timed out at3s and was discarded before application; no such scan is in the final balance aggregation.
- First PR verification stopped before tests because the generated API contract needed its new RPC entry; regenerated and checked. A concurrent support-documentation push canceled the initial main runtime run; reviewed all intervening changes (documentation only), preserved them and waited for complete current-main verification and actual publication. No release guard was bypassed.
- Public Pages root serves release SHA784994c6af9f187304a606458bed7ecb4519e5a9. Served report bundle checked for net-after-credit, historical opening balance, detail action and complete detail Excel labels.

## Production gate
Owner authorized implementation and existing release scope. No merge/application before successful exact-head checks and review of read-only migration. Verify Pages and read-only production reconciliation; no synthetic restaurant transactions.

## Next action
Release complete. Refresh Reports to load the published interface. Oct1 counts00006/00007 remain approved, not applied; no count or historical movement was changed. Negative historical physical balances are not clipped or replaced with recipe consumption. Optional count/data review remains a separate authorized operational action. Rollback frontend first, then docs/sql/period_close_balances_details_rollback.sql; never reverse customer stock or journal entries for a report rollback.

## Mandatory update protocol
Update this log at each verification/release checkpoint; record failures and concrete evidence. Preserve other active changes and main-head compare-and-swap.
