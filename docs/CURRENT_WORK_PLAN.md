# CURRENT WORK PLAN — johna-s — SOURCE OF TRUTH

## Active work
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Latest main baseline reconciled: `a2710f03ec23f7b5711e85cfe045c020e175a44a`
- Current active branch: `fix/journal-cursor-ui-20261005`
- Mandatory active work log: `docs/JOURNAL_CURSOR_UI_2026-10-05.md`

## Operational rules
- السجل هو المرجع الإجباري للعمل، وهذا الملف يحدد المسار النشط الوحيد.
- CI يجب أن يفشل إذا كان السجل الإلزامي مفقودًا أو لا يطابق المسار النشط.
- Single writer; no direct write to main; no force push.
- Unexpected main or branch movement => **STOP_AND_RECONCILE**.
- لا Merge ولا Production migration قبل exact-head Full Verify Green + موافقة صريحة.
- Any new Production function/schema/policy apply requires separate explicit approval.
- Preserve Permission-First, branch isolation, Financial Visibility and live operations.

## Current objective
Connect Journal to the approved/deployed read-only paging API. Return bounded
nested detail with complete authorized filter totals. Preserve legacy get_journals, all
posting functions, policies, table/index definitions, POS, KDS, Print Agent and shifts.
Database PR #453 merged/applied with explicit approval at 17:18 Cairo. This frontend patch
requires exact-head Full Verify; no further Production schema/function/policy changes.

## Verified state
- #450 approved served-resend repair applied; #451 and #452 merged/deployed and verified.
- #449 deployed at e47108f3; exact-head Full Verify 37305692919 and post-merge
  Full Verify 37306845880 passed. Pages deployment 37306845874 passed.
- No real sales, kitchen sends or printing tests were performed by the agent.

## Remaining gated work
- #453 approved/applied; catalog function/policy hashes unchanged. Deployment 37323787272 passed.
- Journal frontend paging: bounded rows, full totals and scoped cursor reset; exact-head CI gate.
- Server aggregation for heavy reports; retain complete print/export and financial formulas.
- Supplier/purchase permission dependencies, costing, period controls and recovery evidence
  remain separate review work.
