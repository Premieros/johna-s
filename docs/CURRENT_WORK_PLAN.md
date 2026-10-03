# CURRENT WORK PLAN — johna-s — SOURCE OF TRUTH

## Active work
- Track: **Loading + POS Resume Experience**
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Latest main baseline reconciled: `c5015e7697fdcab8504c0de0cecd02d285cc8f1b`
- Active development branch: `development/global-page-progress-20261003`
- Mandatory active work log: `docs/LOADING_RESUME_EXPERIENCE_2026-10-03.md`

## Operational rules
- السجل هو المرجع الإجباري للعمل، وهذا الملف يحدد المسار النشط الوحيد.
- CI يجب أن يفشل إذا كان السجل الإلزامي مفقودًا أو لا يطابق المسار النشط.
- Single writer on the active branch.
- No direct write to `main`; no force push.
- Unexpected branch HEAD or latest-main movement => **STOP_AND_RECONCILE**.
- لا Merge ولا Production migration قبل exact-head Full Verify Green + موافقة صريحة.
- No Production schema/data/history mutation in this track.
- Preserve Permission-First, branch isolation, order ownership and POS settlement/inventory truth.
- Printing, Print Agent, KDS, settlement, accounting, shift and dashboard logic remain frozen.

## Current objective
- Show a consistent 0→100% page-loading surface instead of blank/spinner-only transitions.
- Reduce occupied-table / resumed-order hydration latency.
- Never show an existing resumed order as an empty cart while its items are still loading.

## Verified baseline
- ERP-05 code is merged in `main@c5015e7697fdcab8504c0de0cecd02d285cc8f1b`.
- ERP-05 Production migration remains separate and is not applied by this track.
- Route-level lazy pages share one Suspense fallback.
- POS resume previously required authorization + separate order + items + product reads.

## Definition of done
- Lazy page transitions show bilingual visible percentage progress.
- Progress reaches 100% only when the actual fallback completes.
- `authorize_pos_order_access` remains the first resumed-order gate.
- Order + items + products are fetched in one post-authorization query.
- Existing resumed orders show a loading skeleton rather than empty-cart UI.
- Exact-head Verify + DB + Browser Smoke are Green before merge.
- No Production mutation is introduced.

## Queued next work
After this PR closes, open a separate System Health track for **Branch Pulse / نبضة الفروع** with selectable time windows, operational KPIs, user-facing error telemetry and a problems-only view.
