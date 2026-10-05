# CURRENT WORK PLAN — johna-s — SOURCE OF TRUTH

## Active work
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Latest main baseline reconciled: `e47108f32fd0cd8a928447c55f470dbbe2db64c0`
- Current active branch: `fix/journal-server-pagination-20261005`
- Mandatory active work log: `docs/JOURNAL_SERVER_PAGINATION_2026-10-05.md`

## Operational rules
- السجل هو المرجع الإجباري للعمل، وهذا الملف يحدد المسار النشط الوحيد.
- CI يجب أن يفشل إذا كان السجل الإلزامي مفقودًا أو لا يطابق المسار النشط.
- Single writer; no direct write to main; no force push.
- Unexpected main or branch movement => **STOP_AND_RECONCILE**.
- لا Merge ولا Production migration قبل exact-head Full Verify Green + موافقة صريحة.
- Any new Production function/schema/policy apply requires separate explicit approval.
- Preserve Permission-First, branch isolation, Financial Visibility and live operations.

## Current objective
Prepare an additive, read-only journal paging contract outside Production. Return bounded
nested detail with complete authorized filter totals. Preserve legacy get_journals, all
posting functions, policies, table/index definitions, POS, KDS, Print Agent and shifts.
The existing frontend remains on the legacy API until the database proposal is approved
and deployed, followed by a separately verified frontend patch.

## Verified state
- #450 approved served-resend repair applied; #451 and #452 merged/deployed and verified.
- #449 deployed at e47108f3; exact-head Full Verify 37305692919 and post-merge
  Full Verify 37306845880 passed. Pages deployment 37306845874 passed.
- No real sales, kitchen sends or printing tests were performed by the agent.

## Remaining gated work
- Additive journal read API: isolated database tests and exact-head CI; explicit Production approval.
- Journal frontend pagination: only after confirmed API availability, with scoped cursor reset.
- Server aggregation for heavy reports; retain complete print/export and financial formulas.
- Supplier/purchase permission dependencies, costing, period controls and recovery evidence
  remain separate review work.
