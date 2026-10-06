# CURRENT WORK PLAN — johna-s — SOURCE OF TRUTH

## Active work
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Latest main baseline reconciled: `589cb22e50aa2cc4069c49f4d12cb35b5bbabe3d`
- Current active branch: `fix/dashboard-periods-count-pricing-20261006`
- Mandatory active work log: `docs/USER_REPORTS_PERIODS_PRICING_2026-10-06.md`

## Operational rules
- السجل هو المرجع الإجباري للعمل، وهذا الملف يحدد المسار النشط الوحيد.
- CI يجب أن يفشل إذا كان السجل الإلزامي مفقودًا أو لا يطابق المسار النشط.
- Single writer; no direct write to main; no force push.
- Unexpected main or branch movement => **STOP_AND_RECONCILE**.
- لا Merge ولا Production migration قبل exact-head Full Verify Green + موافقة صريحة.
- Any new Production function/schema/policy apply requires separate explicit approval.
- Preserve Permission-First, branch isolation, Financial Visibility and live operations.

## Current objective
Combine the user's complaints and reporting requests in one sequential work plan:
- Today-default dashboard; this month, previous month and custom inclusive Cairo dates.
- Expense account code/name in the complete expense report/print/export.
- Selected-period costing summary/order margins and raw consumption-cost report.
- Optional Excel stock-unit cost retained in new raw-material stock-count drafts.
- Current/last retained actual FIFO inventory cost displayed consistently; manual reference
  price history and historical operation cost remain distinct.
No Production write/apply/publishing is authorized by this implementation step.

## Verified state
- #450 approved served-resend repair applied; #451 and #452 merged/deployed and verified.
- #449 deployed at e47108f3; exact-head Full Verify 37305692919 and post-merge
  Full Verify 37306845880 passed. Pages deployment 37306845874 passed.
- No real sales, kitchen sends or printing tests were performed by the agent.

## Remaining gated work
- #456 phone UI merged/deployed at 589cb22e; Verify 37341254404 and Pages 37341254396 passed.
- #453 approved/applied; catalog function/policy hashes unchanged. Deployment 37323787272 passed.
- #454 journal frontend paging completed and deployed.
- Server aggregation for heavy reports; retain complete print/export and financial formulas.
- Supplier/purchase permission dependencies, costing, period controls and recovery evidence
  remain separate review work.
