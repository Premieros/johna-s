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
