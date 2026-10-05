# CURRENT WORK PLAN — johna-s — SOURCE OF TRUTH

## Active work
- Track: **Incremental read-screen stability with live-branch continuity**
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Latest main baseline reconciled: `b961c6e9f7457f1431ea4594e002de41a6a542a8`
- Current active branch: `fix/stability-report-options-20261005`
- Mandatory active work log: `docs/READ_SCREEN_STABILITY_2026-10-05.md`

## Operational rules
- السجل هو المرجع الإجباري للعمل، وهذا الملف يحدد المسار النشط الوحيد.
- CI يجب أن يفشل إذا كان السجل الإلزامي مفقودًا أو لا يطابق المسار النشط.
- Single writer on the active branch.
- No direct write to `main`; no force push.
- Unexpected branch HEAD or latest-main movement => **STOP_AND_RECONCILE**.
- لا Merge ولا Production migration قبل exact-head Full Verify Green + موافقة صريحة.
- Any Production apply requires separate explicit approval.
- Preserve Permission-First, branch isolation, Financial Visibility and current operational truth.
- Printing, Print Agent, POS transactions, KDS, Send to Kitchen, stock posting, Accounting, Settlement and Shifts remain frozen. Inventory status wording is approved.

## Current objective
User authorized incremental stability work on 2026-10-05. Third reviewable patch: report filter options publish one scoped snapshot, clear on scope change, and expose load failures with Retry.
Journal posting, POS, KDS, printing, shift logic and Production database remain unchanged.

## Verified state
- PR #447 and #448 merged after exact-head Full Verify and user authorization.
- GitHub Pages build, Production API parity and deploy for #448 succeeded (37287871740).
- Current read work preserves the full report printing/export datasets.
- Earlier audit findings are retained in the historical audit worklog, not marked as pending fixes.
- All Production activity in this track is read-only; no new migration is included.

## Remaining gated work
- Exact-head Full Verify and explicit merge approval before deployment.
- Server-side Journal pagination requires a separate API/DB contract with complete summary totals.
- Supplier/purchase policy hardening requires safe operational read dependencies first.
- FIFO costing, period controls and production recovery evidence remain separate review work.
