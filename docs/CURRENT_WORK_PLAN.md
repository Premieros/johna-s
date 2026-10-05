# CURRENT WORK PLAN — johna-s — SOURCE OF TRUTH

## Active work
- Track: **Incremental read-screen stability with live-branch continuity**
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Latest main baseline reconciled: `b4929aa06a5c5b2d8734750f2fad42c30af9d464`
- Current active branch: `fix/settlement-preview-scope-20261005`
- Mandatory active work log: `docs/SETTLEMENT_PREVIEW_SCOPE_2026-10-05.md`

## Operational rules
- السجل هو المرجع الإجباري للعمل، وهذا الملف يحدد المسار النشط الوحيد.
- CI يجب أن يفشل إذا كان السجل الإلزامي مفقودًا أو لا يطابق المسار النشط.
- Single writer on the active branch.
- No direct write to `main`; no force push.
- Unexpected branch HEAD or latest-main movement => **STOP_AND_RECONCILE**.
- لا Merge ولا Production migration قبل exact-head Full Verify Green + موافقة صريحة.
- Any Production apply requires separate explicit approval.
- Preserve Permission-First, branch isolation, Financial Visibility and current operational truth.
- Authorized scope: frontend settlement-preview read consistency only. Payment RPC contract, Print Agent, stock posting, KDS and shifts remain frozen. No Production database changes.

## Current objective
User authorized incremental stability work and the served-resend Production repair on 2026-10-05. First reviewable patch:
Isolate checkout preview by order/branch and refresh the pinned warehouse at confirmation.
Journal posting, POS, KDS, printing, shift logic and Production database remain unchanged.

## Verified state
- #450 merged and approved Production guard patch applied; exact replacement, grants/policy and other function checks passed.
- GitHub Pages build, Production API parity and deploy for #447 succeeded.
- Current read work preserves the full report printing/export datasets.
- Earlier audit findings are retained in the historical audit worklog, not marked as pending fixes.
- All Production activity in this track is read-only; no new migration is included.

## Remaining gated work
- Exact-head Full Verify and explicit merge approval before deployment.
- Server-side Journal pagination requires a separate API/DB contract with complete summary totals.
- Supplier/purchase policy hardening requires safe operational read dependencies first.
- FIFO costing, period controls and production recovery evidence remain separate review work.
