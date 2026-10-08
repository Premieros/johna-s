# Checkout and reports rebuild — 2026-10-08
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `feat/report-column-layout-20261008`
Current PR: #475 (column layout; #473 deployed, #474 separate draft)
Last updated: 2026-10-08

## Work status
State: **BLOCKED** for column-layout production merge pending exact-head Full Verify and separate explicit approval; code preparation and local verification complete. Checkout #472 applied, merged and deployed. #473 approved2026-10-08 16:08 Cairo, merged856bc493, Pages37782100338 and postmerge Verify37782100371 all Green. #474 family navigation remains separate draft, reconciled e36d6c0a; Verify37782280412 monitored.

## Guardrails
Single writer. No direct main writes, force pushes, permission/RLS weakening or SECURITY DEFINER shortcuts. Preserve printing, KDS, inventory, accounting and shifts.

## Baseline
Main856bc49325b1bc814be179ad12981651302db72b (checkout #472 merged; preserves #470 historical costing and #471 serialized reporting reads).
Production function definitions read and pinned before preparing repair.

## Root-cause ledger
Smoha Table48 Johna's-02447 initially open/unpaid: 190 subtotal,40 discount,150 due. User settled with super-admin at 12:11 UTC, invoice Johna's-02608: completed/paid, discount40, total/paid150, split. Receipt falsely says partial because split response omits order_completed. No pending/unsent quantities remain.
Two approvals consumed with split audit shape but no invoice proof. guard_sale_discount requires invoice_number, so split core can reject. Early JSON failures commit approval consumption although no sale was created. Split also compared percentage approval metadata against its normalized amount type. Direct UI discount changes can be discarded by confirmation reading only the server preview.

## Change ledger
Column-layout scope: searchable bounded picker, persisted per-report column order, and selected-column ordering across operational Excel/CSV/print. No database, financial-report formulas, checkout or receipt printing changes.

Reporting foundation: product summaries now use whole-invoice allocations from the station loader before dimension filtering, grouping by branch/product ID/unit. Exposes sold/returned/net quantities and gross/discount/tax/refund/net values. Selected product columns carry through CSV/Excel/print. Column uncheck hides only that column; empty selection persists until Show All. Product display/export source note documents row grain and lifetime-return policy.

Invoice proof added only to split approval audit. Failed split/normal settlement returns unwind all writes via a nested exception block, returning the original structured failure. Direct-discount users persist and verify checkout changes before payment. Split closure now follows the normal sent-only completion rule after exact kitchen finalization, and returns persisted order closure and remaining quantities. A downstream-core rejection regression covers rollback after consumption. Existing stock/accounting/print routines retained.

## Verification ledger
Column layout:1583 frontend tests passed; app/test typechecks, changed-file lint, build, locked DB identity and generated API contract passed. Behavioral export regression verifies205 full rows across Excel/CSV/print with selected ordered headers, plus empty-selection export block. Picker and preference tests cover search, hidden selection, moves, persistence, default reset and invalid saved data. Fresh exact-head CI required.

Reporting foundation: 20 focused tests passed; app/test typechecks and production build passed; full lint has zero errors (15 existing warnings). Full suite:1574 passed, one worklog-state contract failure resolved by accurately recording the reporting production gate as BLOCKED; rerun passed (4/4); combined suite evidence1575 tests passed.

Final exact head 28d470e93f51e90096c37e571980ab46682aef14: 1569 frontend tests,967 DB/RLS tests,121 browser tests, lint, app/test typechecks, build, schema and pages-continuity all Green. Seven new database cases passed, including downstream core rejection and genuine partial closure. Final main reconciled at 8f1041fb; production normal/split/discount-guard hashes unchanged. This final transition is recorded locally and in PR metadata; no additional code commit changes the verified head.

New integration tests: full/partial split closure metadata, split success, percentage approval normalized to money, mismatch rollback, warehouse failure rollback, normal failure rollback. 1564 frontend tests passed; 10 checkout-scope regressions passed; production build passed; application/test typechecks passed; changed-file lint has no errors. Initial CI frontend/build passed; fresh-DB guard identified known canonical/live process_sale drift (guard placement, no-sent error and direct type). Repair now pins both exact baselines and preserves each baseline outside the three atomicity edits. Local PostgreSQL unavailable; full fresh-DB verification required in CI.

## Production gate
Approved checkout_discount_failure_atomicity migration applied successfully; normal hash03a148288dcf37f250e7a49f5afc0cd4,split hash6d372a7806ef0f698b95b8184287a35a. Original ACL/security modes preserved; guard_sale_discount and set_order_checkout_discount unchanged. Table48 remains completed/paid,invoice02608,discount40,total/paid150. User approved fixing checkout; exact-head Full Verify Green required before concrete guarded apply. No real sales or prints executed by agent. Historical closed invoices are audit-only until evidence and correction approval.

## Next action
#473 approved at2026-10-08 16:08 Cairo, merged856bc493, Pages37782100338 succeeded; postmerge Verify37782100371 Green. #474 families draft reconciled e36d6c0a, Verify37782280412 pending. Prepare independent column-layout draft against published main and run exact-head Full Verify before separate production approval.
Run exact-head CI on the column-layout draft, then obtain separate production approval. #473 approval/merge/deployment/verification is complete; do not request it again. No database migration. Continue canonical column definitions, typed aggregation and grouping under the backlog.

## Mandatory update protocol
Record verification transitions and exact head. Reconcile unexpected main movement. Update this log before every mutation scope change.

## Reporting backlog
1. Checkout discount closure repair.
2. Canonical report sources, row grain, sale/refund/discount/tax/status rules.
3. Core report families and approved accounting templates.
4. Shared branch/period/business-day filters and compatible dimensions.
5. Shared configurable table: search, sort, per-column filters, order, widths, pinning.
6. Explicit column aggregation: sum, first/last balance, weighted averages and ratios.
7. Detail/summary/pivot/chart and multilevel grouping.
8. Executive report, prior periods, YoY/YTD; targets later.
9. Drill-down to invoices, tenders, items, movements and journals.
10. Preserve current/recorded/historical-corrected cost distinctions.
11. Historical station/category strategy and audit reports/closing snapshots.
12. Named personal/shared views with permission checks.
13. Bounded server reads, export jobs, freshness/completeness evidence.
14. Consistent Excel/PDF/print and device share.
15. Sales/collections first, then other domains; reconcile totals and regressions.
