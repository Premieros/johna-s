# CURRENT WORK PLAN — johna-s — SOURCE OF TRUTH

## Active work
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Latest main baseline reconciled: `856bc493`
- Current active branch: `feat/reporting-families-20261008`
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

- #473 exact-head Full Verify37779424007 succeeded at87ab6b8c; user approved production merge/deployment2026-10-08 16:08 Cairo. Squash merged856bc493; Pages37782100338 and postmerge Verify37782100371 monitored. #474 family navigation reconciled against this main; fresh exact-head CI and separate production approval required.
