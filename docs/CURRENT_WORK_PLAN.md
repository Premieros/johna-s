# CURRENT WORK PLAN — johna-s — SOURCE OF TRUTH

## Active work
- Repository: `Premieros/johna-s`; production Supabase: `azzdesuowpdcoflmyezn`.
- Baseline: `0e665fc91c54a46c5156909668d1b8d3f59d5ed0` (#545 released).
- Branch: `fix/user-error-clarity-20261029`.
- Mandatory active work log: `docs/USER_ERROR_CLARITY_20261029.md`.
- Owner requests actual understandable error reasons and categories. Frontend error presentation/diagnostic code preservation only. No business data, prices, recipes, stock, permission, printer or database writer changes. No polling. One RLS-filtered header read only after unavailable-order access rejection to distinguish completed/cancelled; successful resume unchanged. لا Merge ولا Production migration before final exact-head verification and separate release approval. Four speculative POS cases remain deferred.

## Active usability polish — 2026-10-25
Owner approved implementing the browser-review findings: compact reports with useful filters and in-page expansion, visible POS branch/dispatch/bill context, readable mobile table cards, safer cancellation presentation and compact dashboard welcome. Presentation only; retain business logic, permissions, queries and installed printers. No production log scans. Prepare one reviewed candidate; publication requires separate final approval.

## Released quick-order access — 2026-10-24
Owner approved merging and publishing #535 after review. Add direct access to open quick orders using existing live data and explain missing kitchen-send permission. Preserve independent action permissions, all kitchen/print writers and production data. No database changes. Required checks must pass before merge.

## Released quantity transfer repair — 2026-10-24
Owner authorized moving a chosen quantity (e.g. 1 of 3 waters) with a rollback path. Review #407/#421 first; preserve exact row identities, print idempotency, sent/served baselines, frozen costs and legacy reversal provenance. Prepare one verified candidate without production mutation or merge. #533 is released; the checkout discount calculation remains unchanged.

## Released existing checkout approval repair — 2026-10-24
Owner canceled changing gross/net discount semantics and adding another product path. Repair only the current approval flow. Preserve the discount/tax formula, all existing invoices and sales/printing/stock operations. Prepare and verify; no Merge ولا Production migration before final approval. #532 is released.

## Historical owner accounting clarity — 2026-10-22
Owner approved repairing the accounting review findings. Prepare a tested candidate, preserving sales, printing, stock writers and database permissions; no Merge ولا Production migration before separate release approval. No new report polling or queries. Month review remains a review, not a newly introduced financial lock. Recipe valuation remains latest approved price with missing prices numerically zero.

## Historical raw transfer safety repair — 2026-10-21
Owner authorizes fixing server unit mismatch, repeated form sends, stale cost reads and hidden metadata errors. Prepare and verify on the isolated branch; no Merge ولا Production migration before final release approval. #530 is released. Preserve stock movement algorithms, all source/destination quantities and cost writers, RLS, installed printers and the Windows pilot.

## Historical production audit repairs — 2026-10-21
Owner authorized repairing the five findings from the read-only production audit. Prepare and test on this isolated branch; preserve installed print agents, all operational security and data. No merge or production migration during preparation. Local Windows pilot remains isolated and forbidden to merge.

## Historical sold-recipe cost report — 2026-10-20
Owner approves preparing sold products × current canonical recipes × latest approved prices, with minimal reads and no sale/printing overhead. Use one batch read on explicit request; no materialized cache table or trigger. Preserve actual inventory/accounting and historical snapshots. #526 is complete; see its PR release ledger. Separate production release approval is required.

## Owner-approved reporting rebuild — 2026-10-20
- Single active writer on main baseline `6d9cf06bbd2572a525e2b4419bdf971437265c1b`.
- Implement essential monthly reports, explicit purchase-only consumption pricing and independent quick-takeaway creation permission. Use focused behavioral checks; retain required release gates. Prepare changes and PR before separate production approval.
- Preserve installed Windows agents, kitchen/bar/receipt pipelines and stock/accounting writers. No production mutations or replay during development. Older scopes below are historical.

## Operator-approved corrective scope — mistakenly added JSON identity export — 2026-10-16
- The owner identified `Premieros/johna-s` as the **wrong repository** for the Sage / Open Mercato integration, and authorized preparing removal of **only PR #509's new export functionality**, on a review branch with **no merge or production deployment** without new explicit release approval.
- Previous active Gregorian UI branch #515 merged as `184933269a10315ace4f97188edef1c676f23735`, with post-merge Verify + Pages SUCCESS. Its scope is closed; this corrective task is the sole active writer, not a parallel task.
- Remove only `products-export-identity` button and accompanying new authorization/download code, its two helper modules and two dedicated unit test files. Preserve existing Excel import/export, product edit, category, recipes, warehouse, costs and permissions. Preserve all operational PRs #510–#515 and all production Supabase data.
- Historical records of PR #509 remain audit evidence; do not rewrite its commit or Git history. Add a review/rollback entry in `docs/REMOVE_MISTAKEN_SAGE_IDENTITY_EXPORT_20261016.md`.
- No DB calls (except existing unrelated app code), no schema/RLS changes, migrations, local/Windows print-agent changes, business transactions, third-party sync, production merge or deployment. Before eventual release: exact-head Full Verify, review diff against #509, and separate user approval.

## Explicit approved database rollout — 2026-10-15 21:29 Cairo
Owner explicitly approved re-requesting the previously declined #510 migration. Same tool and exact tested SQL applied successfully as production migration `20261015183017_operations_stability_all_branches`. Only three function replacements: same-status KDS guard, per-call order matching IDs and lazy identical FIFO read. Both branches covered. Three exact candidate hashes and full unchanged security/catalog fingerprints verified; source reconciliation and fresh CI underway. Preserve deployed #511, all monetary/stock/print contracts and disabled #507 handoff. Installed-agent pickup latency remains a separate unresolved investigation.

## Historical independent frontend release after initial decline
The owner requests fixing all verified failures for Smouha and Cleopatra. Candidate #510 passed exact-head Full Verify (1795 frontend,1071 DB,132 Chromium) but Supabase declined the production migration without a reason. Original production function hashes remain unchanged. Do not bypass that decline. #510 is staged, not executable. Release only its independent frontend thermal report/shift audit changes in #511, with fresh exact-head verification and no SQL/agent changes. Prior export-only scope below is historical. Maintain one sequential writer and preserve #508/#509 and print idempotency.

## Owner-approved scope switch — Sage identity export — 2026-10-15
- Owner explicitly approved making **Sage ↔ Open Mercato integration** the next active development track in this conversation. This updates the single-writer gate first, before feature changes; other hotfix/benchmark PRs remain non-executable unless separately activated.
- Prior costing PR #508 is merged on main at `322348f3d772341cce7484f793dfec94cf0b533b` after verification; kitchen PR #507 is merged at `693cd639a28fc2655941d6bc26fcd8a8d78f9be3`. Preserve both results, and keep the experimental kitchen print handoff **OFF**.
- Stage only **authorized, branch-scoped, read-only identity-preserving product JSON export** in Sage with same-browser download (product ID, branch ID, name, SKU, product type and active state). No Supabase mutation, schema/RLS, prices, stock, recipes, printing, Windows agent or business transactions.
- Target format is compatible with Open Mercato's existing local JSON catalog parity reader. Export must reject missing branch selection, changed branch scope and incomplete pages. No SKU synthesis or automatic imports.
- This approval is for the development track and a draft PR, **not** a production merge, Sage DB migration, cross-database credential connection or live rollout. Gate release on exact-head Verify and separate owner production approval.
- Mandatory sequential HEAD fence and all prior recovery protocols still apply. New active log: `docs/SAGE_OPENMERCATO_IDENTITY_EXPORT_20261015.md`.

## Released costing read repair — both branches — 2026-10-15
- Applied production migration `20261015071859_costing_detail_two_branch_batch_read`: detail price fields and internal recipe estimates batch the same existing raw-price resolver, preserving values, precision, nulls, permissions and response JSON.
- Smouha and Cleopatra are covered. Current detail MD5 `732777a33b67f9a6c1da8de4fa0a0431`; recipe helper MD5 `8b0bc11afaab1a9a967589aa90159e55`.
- Immediate authenticated same-user reads: Smouha Avocado 1280→290ms, Cleopatra Avocado 2467→231ms, Smouha Chicken Fajita 3222→253ms, with identical full JSON for all three. Cleopatra Chicken Fajita improved from >6500ms safety timeout to 304ms, retaining all compared raw contexts and original aggregate cost (complete old JSON unavailable).
- Functional/recovery source `a068a58f`, full run `38697228401` green 4/4, 1068 DB tests including 16 targeted costing tests and exact rollback rehearsal. Final merge and post-merge status: see PR #508 and Actions. No claim of peak-load/global timeout cure.
- Guarded recovery: `scripts/rollback/costing_batch_restore_smouha_pilot_20261015.sql`, restoring the prior Smouha-only pilot and original recipe helper. No kitchen/print/Windows/FIFO/stock/accounting/settlement changes; print handoff server gate remains OFF. Existing print read indexes already cover both branches.

## Current emergency staging: atomic kitchen print handoff — 2026-10-14
- This isolated candidate attempts to eliminate the gap between successful kitchen send and durable cloud print job creation. It is outside canonical migrations, **not applied** to production and must not change the V8 Windows agent or replay old orders.
- Active branch `hotfix/kitchen-atomic-remote-stop-20261015` (draft #507, remote stop); targeted proof in `tests/integration/kitchen_atomic_print_handoff.test.ts`. A queued job uses the established sorted per-station send-id/quantity identity; frontend enqueue must remain idempotent and never print twice.
- Rollout explicitly BLOCKED until exact isolated send/void/FIFO/authorization/template/performance proof and separately reviewed migration. The latest live 4h sample had 0 missing cloud jobs across 54 kitchen-sent orders; last-hour Smoha claim p95 ~11.8s remains a separate symptom.
- No production SQL/indexes, orders, printers, financial transactions or Windows code changed by this track. Browser polling proposal #504 remains closed. Documentation: `docs/KITCHEN_ATOMIC_PRINT_HANDOFF_2026-10-14.md`.

## Database read recovery — 2026-10-14
- Single active track #501. #500 is merged/deployed/verified at7ee48378;1741 frontend/1044 DB/132 browser tests Green.
- Owner redirects #501 to reducing total DB consumption: implement frontend notification and print-monitor read reduction only. Six-index proposal is HELD after measured purchase WAL amplification; no activation. Preserve actual print agent/claim/ack loop and all kitchen/stock/accounting writers.
- No production index/SQL apply, canonical migration, function/RLS/accounting/agent change, operation replay or live test orders/prints. The earlier kitchen dedup rollout stays disabled.
- Final exact-head Full Verify and explicit owner production/index approval plus a suitable verified dedicated connection are required. Do not mask query cancellations or claim payment timeouts fixed without evidence.

## Historical session and screen recovery — 2026-10-13 / 2026-10-14
- Owner directs continuing investigation/preparation after live log review. Frontend-only draft; publication requires separate approval after exact-head checks.
- #499 merged/deployed as46f1277; postmerge1715 frontend/1042 DB/132 Chromium Green. Guard already applied; optimization remains disabled.
- Owner requests actual repairs2026-10-14:distinguish unavailable refresh from revoked session, guard stale auth/branch responses, bound notification refreshes and stage two print read indexes. Preserve explicit logout/account disable, all operational writers/printing and original chunk-causality HOLD. No production apply/merge without final approval.

## Emergency recovery — 2026-10-13
- #499 is the single active track. Approved rollback20261013140753 restored service; user confirmed multi-item send works. Optimization stays disabled.
- Confirmed table43/Cleopatra ticket enqueued to Smoha: fix authoritative print order branch and server guard. Cart/saved-order recovery included. Owner approved guard/deployment at17:38 Cairo; migration20261013144819 applied and verified. Only archive replay CI and publication pending.

## Historical approved SQL activation — 2026-10-13
- User explicitly approved production SQL activation at15:03 Cairo. #497 already merged/deployed with postmerge tests Green.
- #498 was the completed activation track: test an enforceable short activation barrier and apply exact guarded package on johnas, then reconcile applied history and verify. Approval is present; technical gate remains pending.
- Earlier no-apply sections below are historical, not a revocation of this approval. No unrelated project, printing test or parallel writer.

## Owner-directed implementation — 2026-10-12
- New single active development track: negative-stock kitchen read deduplication.
- #496 is merged/deployed and postmerge Verify 38295468229 is Green. Its experiments are not activated.
- #492–#494 remain historical isolated proposals, read-only inputs to this track; no simultaneous execution.
- Preserve negative-first consumption; remove redundant reads, not branch/warehouse/auth/idempotency protections.
- First implementation is isolated recipe/component reuse; production inventory writes remain canonical.
- No production SQL, merge or deployment authorized by the plan/preparation request.

## Emergency production incident — 2026-10-11
- Live PostgreSQL logs prove that the PR #482 BEFORE INSERT ingredient-price snapshot trigger can hit statement timeout inside send_to_kitchen, rolling back kitchen sends and delaying print enqueue. See `docs/KITCHEN_SEND_EMERGENCY_2026-10-11.md`.
- Proposed emergency response: pause ONLY that price-reporting trigger, preserving stock FIFO, order warehouse binding, KDS, printing, financial journals and all historical snapshots. The trade-off is UNKNOWN sale-cost report pricing for newly sent items while paused; do NOT backfill at newer prices.
- **Approved and applied 2026-10-11:** production Supabase migration `20261011063452_pause_blocking_kitchen_price_snapshot_20261011`; named price-capture trigger verified `D`, unrelated kitchen source-link trigger remains `O`. First Full Verify `38117909929` was Green. No kitchen print/order events observed immediately after apply, so speedup and physical print must still be proven at both branches. Draft PR #488 migration filename now aligned with applied version; repeat exact-head CI before any merge.

## Approved post-#488 kitchen follow-up — 2026-10-11
- Emergency PR #488 was merged into main at `0f2bd306eb5eb925960b6581d1b40cd1312ecd2f`; its Supabase migration `20261011063452` **had already been applied** with target trigger disabled. Do not reapply or re-enable it.
- Owner authorized ordered #488 then #490 merge subject to exact-head verification and staging of unrelated production SQL. #490 contains only frontend print-queue and warehouse guard code, tests and an **unapplied** index candidate archived at `scripts/experiments/kitchen_fifo_print_indexes_candidate_20261011.sql`.
- The indexing proposal is **not** a canonical migration and cannot auto-run on merge. Before any real SQL index creation require separate owner permission, query-plan/write-lock assessment and a distinct future rollout.
- Do not create operational test orders or print tickets; previous operator-confirmed Cleopatra prints remain historical evidence. Restore per-event frozen ingredient prices only in separate permission-preserving #486 remediation.

## Active issue #486 — bounded kitchen approved-price candidate (2026-10-11)
- #488 and #490 have both merged/deployed, exact-head and post-merge Full Verify green. Their fixes do NOT restore frozen per-ingredient approved prices for new kitchen sends.
- This branch proposes ONLY `scripts/experiments/kitchen_approved_price_bounded_candidate_20261011.sql` and rollback-only CI tests. New SQL is NOT under `supabase/migrations`, NOT applied to production, and does NOT change or enable any trigger.
- Source ranking preserves approved purchase/pricing/stock-count precedence, financial purchase visibility, branch/RLS scope and dispatch-time cutoff. No FIFO or accounting changes.
- Follow-up requires full role/as-of parity and production-equivalent benchmark. Separate owner approval for any production DDL/trigger enable; no test orders or printer tests in production.

## Owner-approved kitchen price Stage A — applied 2026-10-11
- Owner provided full approval for production kitchen approved-price repair. Stage A applied as Supabase migration `20261011105541_kitchen_approved_price_stage_a_install_disabled_20261011`, verified installed helper and adjusted capture function while price capture trigger remains `D` and source-link trigger `O`.
- The exact SQL was recorded in canonical `supabase/migrations/20261011105541_kitchen_approved_price_stage_a_install_disabled_20261011.sql` with matching already-applied production version; do NOT double-apply.
- Stage B remains a *separate activation step* requiring exact-head CI with **actual isolated** send/resend/void snapshot lifecycle and production parity/guard checks. Do not create live operational test orders, touch FIFO and journals or backfill unknown costs. Emergency disable script prepared.

## Owner-approved kitchen price Stage B — applied 2026-10-11
- Stage B applied to production Supabase as migration `20261011111235_kitchen_approved_price_stage_b_enable_20261011`, after exact-head Full Verify `38133988775` all 4 jobs green, 991 DB integration tests and isolated first-send/re-send/void Stage B price snapshot rehearsal.
- Post-apply production read-only proof: `trg_capture_kitchen_ingredient_prices` `O`, `trg_sync_sale_source_order_from_kitchen_event` `O`; candidate function ACL still excludes anon. First real kitchen event since enable froze one approved purchase cost and retained one unknown as NULL; no fake order, historical price backfill, FIFO or accounting change.
- Canonical `supabase/migrations/20261011111235_kitchen_approved_price_stage_b_enable_20261011.sql` reconciled with **already applied** production version. Never replay an equivalent new migration by another name.
- Latest CI must be rerun for the exact branch head after canonical Stage B insertion and isolated fixture baseline adjustments; no merge until green. Physical print and real sustained P95 are not proven from unit/DB/browser tests. Emergency disable proposal remains available if latency/error regressions occur.

## Operational rules
- السجل هو المرجع الإجباري للعمل، وهذا الملف يحدد المسار النشط الوحيد.
- CI يجب أن يفشل إذا كان السجل الإلزامي مفقودًا أو لا يطابق المسار النشط.
- Single writer; no direct write to main; no force push.
- Unexpected main or branch movement => **STOP_AND_RECONCILE**.
- لا Merge ولا Production migration قبل exact-head Full Verify Green + موافقة صريحة.
- Any new Production function/schema/policy apply requires separate explicit approval.
- Preserve Permission-First, branch isolation, Financial Visibility and live operations.

## Current objective — approved 2026-10-09
Operational sale costs use only saved raw-material unit costs captured at **Send to Kitchen**: consumed quantity × latest positive approved price available at dispatch. Never calculate FIFO in sales-cost reports or reprice old sales with new prices. Show priced ingredients and their known subtotal, leave unknown prices NULL. Keep separate FIFO inventory deductions, historic postings and financial journal valuations unchanged.

## PR #482 / frozen kitchen prices
- New, unapplied migration: `20261009143000_kitchen_sale_known_price_snapshot.sql` captures unit_cost, price_source and priced_at in the existing component_snapshot on INSERT for future kitchen events only.
- Sales cost and station reports, Excel and CSV use frozen snapshot values; no inventory_ledger or current-price scan in their read path.
- Remove obsolete actual-FIFO button, costMode parameter and misleading FIFO/current-price labels.
- Display a partial known total when only some materials have approved prices, never a manufactured zero/complete margin.
- Old sales stay historically unavailable if snapshot lacks price; no backfill using later prices.
- CI must pass on the exact final head before asking user to approve merge. **New production trigger requires its own explicit approval**; no live SQL applied by this PR preparation.

## Accounting reconciliation — 2026-10-09
- Source PR: #445, historical branch diverged and merge-conflicted.
- Rebased by porting the migration, rollback, targeted unit/integration tests and worklog to this fresh main-based branch, with original PR left unchanged.
- Future-only accounting fix; never rewrite historical journals.
- SQL migration intentionally NOT applied to Production. Exact-head CI, fresh-DB integration, production definition parity and final approval are required before applying.
- Follow-up: successful CI then review migration signatures against production, followed by separately authorized production application and post-apply verification.

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

Production approval2026-10-08 20:04 Cairo: user explicitly approves applying consolidated reporting migration and merging/deploying#475. Exact head98390df838490889c4143607a38843abdbaa1abe / Full Verify37811310007 Green:1619 frontend,970 DB/RLS,124 browser; production mainc86116d3 unchanged. Live page body matches canonical baseline/hash a69aea21be0af3cfb9a7018d17b08290; four new source functions absent. Catalog fingerprints pinned for all other functions, tables/ACL/RLS, policies and triggers. Apply exact tested SQL with2s lock/10s statement bounds, verify before merge; no real sales or printing tests. This approval transition is recorded locally and in PR metadata without changing the verified head.

Approved apply completed: exact five source-body hashes match; all invoker/authenticated-only. Catalog fingerprints for other functions, policies, tables/ACL/RLS and triggers unchanged; existing page ACL preserved. Live Smoha source parity301 invoices/net80874.5; inventory278 raw groups/6 unit groups. PR475 mergeddd4bdeef5e3fcc01197ea5e557d7864d90aff4c6; deployment and postmerge verification in progress. No transaction/printing writes.

GitHub Pages deployment37814067770 SUCCESS, production-parity job Green. Public homepage and deployed index-BHO3XVsh.js returnHTTP200; no signed-in/operational transaction invoked. Postmerge Full Verify37814067672 still in progress.

Completed#475: Pages37814067770 and postmerge Full Verify37814067672 SUCCESS atdd4bdeef5e3fcc01197ea5e557d7864d90aff4c6. Public reporting-G6rqGK4L.js returnsHTTP200 and contains dataset/metrics/stock APIs; index hash matches deployed build. User feedback20:16 Cairo: long/technical report navigation and overlapping views; requests clearer sales-cost and as-of balance reports. Screenshot inspected successfully after attachment became available. Audit finds costs inside station/profit views and historical closing quantities in movement/raw reports, but not clear primary entry points. Review basic report navigation/presets and period versus end-of-day balance semantics; no new production changes in this UX review.


### Basic report workspace — approved preparation2026-10-08 21:58 Cairo
User directs implementation of the reviewed seven basic reports, merged view discovery, compact advanced filters, clear sales-cost reporting and balances as of a chosen date. Baseline maindd4bdeef;#475 applied/deployed/verified Green. Prepare frontend-only changes in one new draft; no production schema/transaction change. Reuse canonical sales/items/cost and existing raw material historical movement RPCs. Date balance is raw-material ledger closing quantity/value at end of selected Cairo day, not current batches filtered by date; individual inventory/treasury/party statements retain their separate grains and permissions. State: **BLOCKED** for production merge until exact-head verification and explicit approval.

## Active consolidated draft #476
Seven basic reports and internal views, cost completeness, and dated material balances. Local 1625 frontend tests passed; app/test typechecks, build, lint (0 errors/15 existing warnings), API contract and locked identity passed. Production gate remains blocked pending exact-head Full Verify and explicit user approval. Frontend-only; no migration.


## POS failures follow-up — 2026-10-08
Active PR #477 addresses incomplete required modifier selections through the plus button and failed configuration reads. Current-price reads use bounded sequential batches; costing reads release database capacity before follow-up queries. Historical generic CLIENT_ERROR causes remain unresolved. User explicitly approved merge/deployment at 23:23 Cairo after reviewing scope. No production database changes are included. Exact-head Full Verify remains required before merge. Previous reporting sections are historical context, not active parallel work.


## Shared raw-price timeout follow-up — 2026-10-09
#477 merged at8df96523 after exact-head Full Verify37843961082 passed; Pages37845279299 succeeded. Live POS and price chunks contain the new configuration marker, error context and bounded batch argument. User reports the same database timeout across multiple screens. Prepare a separately reviewed database read optimization on fix/raw-price-sql-timeouts; no production SQL apply is authorized yet. Preserve all security modes, grants, price precedence, stock values and RLS/Financial Visibility.


### Explicit report requests and shared results — 2026-10-09 00:22 Cairo user direction

User instructs implementing manual report requests, a small default period and reuse of the same authoritative results between screens; permission to proceed with the best/fastest repair remains in force. Consolidate this frontend scope and the prepared two-function SQL optimization into #478. Frontend delivery is authorized by that implementation request; any new production SQL function apply remains separately gated by the explicit rule above.

- Operational, financial and costing result reads now require Run report. Opening a screen, switching views/branches or editing dates does not start a heavy result read. Default dates are today; URL periods remain respected. Idle/error results cannot masquerade as zero totals or be exported. Small selector lookups remain automatic.
- Identical read-only reporting RPCs share an in-memory result for at most60 seconds, bounded to16 entries and2MiB per response. The key includes all request headers/JWT and exact normalized parameters (branch, period and filters); permissions/profile changes clear reuse and scope results. Writes invalidate cached/pre-write reads. Errors are not retained. Refresh report clears reuse and explicitly reads latest data. Operational writes and live dashboard reads are not cached.
- Costing overview no longer requests unused FIFO/current-price datasets. Period branch reads are sequential, stale follow-up reads stop, raw-valuation failure is unknown/error rather than a zero value. Shared historical/current-price RPCs reuse identical parameters across the costing tabs and other consumers.
- New request-count, scope/cancellation/expiry/mutation tests and browser cross-view reuse/refresh checks cover behavior. Existing full-report/export completeness and financial/RLS tests remain. React hook, stale-response and accessible button review completed. Prepared migration is unchanged and UNAPPLIED.
- Earlier SQL-only headc9ed4673 Full Verify37846203726 Green. Previous production main8df96523 post-merge Full Verify37845279360 Green. Final consolidated exact-head Full Verify is still required; State: **BLOCKED** until those checks complete, and production SQL additionally requires separate approval.

Final local frontend validation:337 test files /1643 unit-component tests passed. Final16 focused request/costing/worklog tests passed after scope guards. App/test typechecks, production build, API contract, locked project identity and lint (0 errors/14 existing warnings) passed. Browser cross-view behavior awaits exact-head CI; no local browser success is claimed. SQL migration remains unapplied.

Final capacity follow-up: six multi-branch report families (including raw valuation/current cost) read branches sequentially rather than submitting heavy per-branch RPCs concurrently. The screen-read hook now passes an independent AbortSignal and aborts stale callers; branch readers stop before requesting another branch and reject errors/cancellation without partial output. Existing output order/totals retained.29 targeted report/cache/cancellation tests and app/test typechecks passed; final complete verification remains required.

Final branch-capacity validation:338 local test files /1645 unit-component tests passed, with unchanged pricing/costing SQL. Build, typechecks, changed-file ESLint and API contract passed. No production SQL applied.

Browser verification correction:exact headcb53ff2a Full Verify37848784002 passed1645 frontend and971 DB/RLS tests plus Pages continuity;119 browser tests passed and6 failed. Native Request inspection in the original GET coordinator transferred/consumed the POST body before handing it to fetch when the new report cache supplied a Request object. Reproduced with the native Request constructor; preserve the original upload body while inspecting. Add an integrated two-transport native-body consumption regression. Remove one incorrectly added report-button click from the unrelated KDS browser test. All original report output/read-count and KDS assertions retained. No production deployment or SQL apply; fresh exact-head Full Verify required.

Native body correction local verification:338 files /1646 frontend tests pass;28 focused transport/report tests, app/test typechecks, build, changed-file lint and contract check pass. No production deployment/apply. Publish corrected head and require fresh Full Verify.

Transport consistency follow-up:invalidate shared reports both before and after a mutation completes, so a report read during an outstanding write cannot be retained as a post-write result. Added a delayed-write native-body regression. No report numbers, permissions or SQL changed; exact-head verification remains required.

Write-completion follow-up:12 focused transport tests pass; app/test typechecks, build and changed-file lint pass. Prior complete local suite1646 tests was Green. Require Full Verify on the updated head; production remains unchanged.

Corrected transport headc5a278d2 Full Verify37851029825 passed1647 frontend and971 DB/RLS tests plus Pages continuity. Browser:123 passed, inventory request-count test flaky (two batch reads on first attempt, zero after retry), and new cross-view test failed only at detailed invoice rendering because its synthetic sale omitted mandatory created_at. Add a date within the requested period plus normal sale fields. Start the stock test on a fresh report document before installing counters, excluding possible pending dashboard reads from the report contract. Exact output, one shared dataset/two after forced refresh, zero report batch reads and all KDS assertions retained. Application and SQL unchanged; fresh exact-head Full Verify required. No production deployment or SQL apply.
