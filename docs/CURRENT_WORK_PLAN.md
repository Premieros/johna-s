# CURRENT WORK PLAN — johna-s — SOURCE OF TRUTH

## Active work
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Latest main baseline reconciled: `c86116d3`
- Current active branch: `feat/report-column-layout-20261008`
- Mandatory active work log: `docs/CHECKOUT_REPORTS_REBUILD_2026-10-08.md`

## Operational rules
- السجل هو المرجع الإجباري للعمل، وهذا الملف يحدد المسار النشط الوحيد.
- CI يجب أن يفشل إذا كان السجل الإلزامي مفقودًا أو لا يطابق المسار النشط.
- Single writer; no direct write to main; no force push.
- Unexpected main or branch movement => **STOP_AND_RECONCILE**.
- لا Merge ولا Production migration قبل exact-head Full Verify Green + موافقة صريحة.
- Any new Production function/schema/policy apply requires separate explicit approval.
- Preserve Permission-First, branch isolation, Financial Visibility and live operations.

## Current objective
User confirms the previous writer has finished and authorizes starting the agreed
work list. First repair discounted normal/split checkout failure atomicity and invoice
proof, including direct discount persistence at confirmation. Then rebuild reporting
with shared definitions, accurate allocation, configurable tables and source traceability.
#470 and #471 are merged. Preserve their current and historical costing changes.

## Verified state
- #450 approved served-resend repair applied; #451 and #452 merged/deployed and verified.
- #449 deployed at e47108f3; exact-head Full Verify 37305692919 and post-merge
  Full Verify 37306845880 passed. Pages deployment 37306845874 passed.
- No real sales, kitchen sends or printing tests were performed by the agent.

## Remaining gated work
- #458 completed at a656caf2: approved count/FIFO reporting migrations applied;
  Verify 37428702085 and Pages 37428702093 passed. All five requested features deployed.
- #456 phone UI merged/deployed at 589cb22e; Verify 37341254404 and Pages 37341254396 passed.
- #453 approved/applied; catalog function/policy hashes unchanged. Deployment 37323787272 passed.
- #454 journal frontend paging completed and deployed.
- #459 completed at 8bb7f48b: bounded report reads/deferred costing deployed;
  post-merge Verify 37441343533 and Pages 37441343568 succeeded.
- Supplier/purchase permission dependencies, costing, period controls and recovery evidence
  remain separate review work.

- #460 completed at 70f25fe3: KDS archive/empty finish applied and deployed;
  postmerge Verify 37450491227 and Pages 37450491020 green.

- #461 completed at a6a54802: hidden display reads/coalescing deployed;
  postmerge Verify 37454652097 and Pages 37454651969 green.

- #462 completed at 247e65de: metadata parity API applied as 20261006120006;
  postmerge Verify 37460567653 and Pages 37460567637 green; parity 216 -> 2 requests.

- #463 completed at a6e838ae: all-section refresh/error visibility deployed;
  postmerge Verify 37478093699 and Pages 37478093744 green.

- #466 completed at 627b379b: station sales report deployed; Full Verify 37670195057 and Pages 37671923579 green.

- #468 approved checkout discount repair deployed and verified.
- #469 approved recipe cost consistency migration applied; main 5f085641; Verify 37763464358 and Pages 37763464375 Green.

- #472 approved checkout migration applied, exact live function hashes verified, merged at fcb2c25d. Pages deployment37777968084 succeeded; post-merge Verify37777968117 succeeded (frontend, DB/RLS, browser and pages-continuity).

- #473 explicitly approved2026-10-08 16:08 Cairo, merged856bc493 and Pages37782100338 succeeded. Postmerge Verify37782100371 Green. #474 families approved2026-10-08 16:33 Cairo and mergedc86116d3 after Full Verify37782280412 Green. Pages37785343543 and Verify37785343690 monitored. Current work adds column search/order and selected-column exports, reconciled against merged #474. Only work-log files conflicted; application changes combine without conflicts.

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

Exact heade1abc24c Full Verify37808315016: frontend/pages continuity Green;969 database tests pass, one new returns assertion fails because the preceding history test moved its205 shared fixture invoices into restricted history. Reset only refunded fixture timestamps inside the secondary-source SAVEPOINT, then roll back. Production source/history rules unchanged. Fresh exact-head Full Verify required.

Exact head9061cfa5 Full Verify37809355100: frontend/pages continuity and all970 database tests Green;122 browser tests pass, stock read-count test fails and cashier count is flaky. Equivalent empty branch lookup refreshes recreated the report reader and issued redundant reads; use stable branch ID/name/name_en contents as the scope key, preserving real changes. Add component regression for identical contents versus changed labels. Low-stock browser test waits for its distinct result rather than the previous stock label. Typecheck and34 focused tests pass; changed-file lint pending. Fresh exact-head Full Verify required.
