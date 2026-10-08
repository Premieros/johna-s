# Checkout and reports rebuild — 2026-10-08
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `feat/report-column-layout-20261008`
Current PR: #475 (column layout; #473 deployed, #474 merged)
Last updated: 2026-10-08

## Work status
State: **BLOCKED** for column-layout production merge pending exact-head Full Verify and separate explicit approval; code preparation and local verification complete. Checkout #472 applied, merged and deployed. #473 approved2026-10-08 16:08 Cairo, merged856bc493, Pages37782100338 and postmerge Verify37782100371 all Green. #474 family navigation Full Verify37782280412 Green at e36d6c0a; user approved2026-10-08 16:33 Cairo. Mergedc86116d3; Pages37785343543 and postmerge Verify37785343690 monitored. #475 column layout reconciled against this main; fresh exact-head CI required.

## Guardrails
Single writer. No direct main writes, force pushes, permission/RLS weakening or SECURITY DEFINER shortcuts. Preserve printing, KDS, inventory, accounting and shifts.

## Baseline
Mainc86116d3c64e1dbe720c84d614c67a6758888b9f (checkout #472 merged; preserves #470 historical costing and #471 serialized reporting reads).
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
Freeze the consolidated #475 source/configurable-report package, publish one review commit on the existing draft, and run exact-head Full Verify. Prepared migration `20261008141141_unified_operational_report_source.sql` remains UNAPPLIED. After all checks are Green, request one concrete approval covering that migration and the same PR merge/deployment. No additional PR or production operation before that gate.

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

## Consolidated delivery — user direction2026-10-08 16:39 Cairo
Remaining reporting work is consolidated into PR #475. No additional stage-by-stage merge/deployment requests. Expand the draft to source/grain/aggregation contracts, full-data table filters/sort/grouping, widths/pinning, saved layouts, comparisons and source drill-down. One final exact-head Full Verify and production approval after the consolidated scope is reviewable. Frontend-first; any necessary production migration remains separately gated. Preserve permission/history boundaries and bounded reads; never analyse only a server page as the full dataset.


### Performance steering — 2026-10-08 17:00 Cairo
User requires low database consumption and unified sources. Added scope-local shared full-read cache across analysis/export/comparison; concurrent requests reuse the same promise, failures retry, scope changes abort/discard data, cache holds current plus two comparison periods. Source pagination now rejects more than 5,000 records without partial output and stops with a one-record boundary check. Core report counts reject oversized analysis/export before another full read. Default tables remain server paginated; comparison remains explicit.
These controls reduce duplicated transfer but are not a replacement for a canonical database reporting layer with server-side dimension filters/aggregation and indexed query plans. That architecture/performance verification remains required before declaring the full rebuild complete or asking for the single final production approval. No production schema or permissions changed.


### Canonical operational source preparation — 2026-10-08 17:20 Cairo
Prepared migration `20261008141141_unified_operational_report_source.sql` inside #475 only (NOT applied). Sales/purchases/posted expenses now share one SECURITY INVOKER filtered result function. Existing 100-row page wrapper retains its signature and 200-row validation; bounded dataset wrapper returns one complete result or rejects >5,000 records. Export loaders no longer construct separate PostgREST queries. Server metrics wrapper executes with LIMIT 0 and returns additive comparison totals only. Comparisons with row-level filters retain the exact bounded dataset path; changing row filters invalidates/aborts prior metric comparisons. Both date inputs and UTC bounds use the captured applied context. Caller RLS/history and anonymous ACLs preserved; no table, policy, stock/accounting/printing change.
Production read-only baseline: Smoha October1–8 sales first100 query used an index and ran28.693ms without caller RLS; existing page RPC under active authenticated super-admin role ran143.806ms. These are current-source baselines, not timing proof for the prepared migration. New source parity, foreign-branch denial, compact metrics and invoker ACL tests added to isolated integration suite. New database changes require final explicit production approval.
Supabase CLI generated the migration file, then automatic approval review rejected its telemetry attempt to untrusted PostHog with unknown metadata. No retry/bypass was attempted. Continued with the already-created local file and connector read-only SQL. No further CLI execution is needed for the prepared change.


### Browser regression correction — 2026-10-08
Full Verify37793693299 passed1,608 frontend and968 database/RLS tests; browser suite passed121 but failed the new full-analysis flow. Root cause: the report reader function was passed directly to React state setters as a scope identity; React executed it as an updater, preventing the workbench from opening and issuing unintended reads. Both setters now store the function via a returning callback. Added a function-scope regression alongside the end-to-end205-row/cache/compact-comparison check. A fresh exact-head Full Verify is required before approval. Canonical-source migration remains unapplied.


### Browser locator correction — 2026-10-08
Exact headf0c97c94 Full Verify37796662455 passed1,609 frontend and968 database tests. The new browser flow confirmed205-row loading, one canonical dataset read and cached compact comparisons. Its later invoice-filter locator matched both Invoice and Invoice Total in Arabic. Anchored the accessible-name match to the exact Invoice filter; assertions and application behavior retained. Fresh exact-head verification required; no production apply.


### Remaining-source consolidation — 2026-10-08 18:44 Cairo
User authorizes continuing all remaining source review inside #475, with one production delivery after completion. Prior head0dc7b4d Full Verify37798296102 Green (1609 frontend/968 database/122 browser); no apply/merge/deploy. Next scope consolidates secondary invoice/employee/cashier/return reads into the canonical sales source, preserves cashier identity, enforces returns and product/category filters before source limits, unifies product consumption with allocated product rows, and removes duplicate component-consumption builders. Review stock/accounting sources individually without replacing their authoritative grains. Prepared migration may be edited while unapplied; no production schema/RLS/operation change. CLI telemetry rejection remains in force; no further CLI invocation.

Stock-source scope: read-only production parity found535 raw material/branch pairs with zero differences between batch sums and cached branch quantities;15678 raw batches and zero nonzero legacy batches without warehouse IDs. Prepare one invoker stock RPC to aggregate raw and unit batches before returning inventory/low-stock projections. No new view, table, RLS policy or stock write routine. Negative quantities and zero-stock active masters retained.


### Consolidated source review — 2026-10-08 19:17 Cairo
Invoice, employee, cashier and returns loaders now share the canonical dataset, preserving cashier IDs and applying dimension filters before limits. Station/product/top-consumed views request complete invoice items through that source; whole-invoice allocation precedes product filtering. Both invoice/item bounds reject incomplete data. Cost-event/ledger chunks enforce a cumulative5,000-row limit.
Inventory/low-stock use one SECURITY INVOKER stock RPC, aggregating permitted batches before returning projections. Warehouse aggregation precedes low-stock limits; negative balances, zero-stock active masters and unavailable metadata identities remain visible. Component ranking reuses its source; category filters use an inner embedded join and product branch lookups are bounded/chunked. No stock writes or accounting formulas changed.
Financial views retain eleven authoritative accounting RPCs. Failures now block partial totals/exports and offer retry. Scope changes abort/discard obsolete responses. The API-contract generator recognizes optional AbortSignal:166 RPCs/57 tables.
Local checks:1,617 frontend tests passed before the final new contract test; final focused40 tests, typechecks and contract check pass. Final full local run and exact-head database/browser verification pending. Previous Green0dc7b4d does not certify these edits.
Read-only authenticated Smoha stock EXPLAIN:1,479.464ms;278 raw groups from9,696 batch rows and6 unit groups. The projection reduces transfer/client joins; per-row RLS still consumes database work. No percentage speedup or eliminated database cost is claimed. Migration remains UNAPPLIED; production baselinec86116d3.
Scope boundary: configurable basic reports and source consolidation are this package. Shared views, pivots/charts, complete document/item/journal navigation, YTD executive templates and background export jobs remain backlog. The entire fifteen-item roadmap is not complete.

Final local verification:1,618 tests/334 files passed; production build, application/test typechecks, contract166/57 and diff whitespace check passed. Exact-head Full Verify still required.
