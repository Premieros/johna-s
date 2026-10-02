# CURRENT WORK PLAN — johna-s — SOURCE OF TRUTH

## Active work
- Track: **POS product browser render performance**
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Latest main baseline reconciled: `8bbd03a1350305c0948decc1955cc7eced6ebce5`
- Active development branch: `performance/pos-product-browser-render-20261003`
- Mandatory active work log: `docs/POS_PRODUCT_BROWSER_RENDER_PERFORMANCE_2026-10-03.md`

## Reconciled predecessors now on main
- PR #428 — POS financial safety hardening — merged at `84f4a1d78dcbe88173d0d070d9ff54ca8ea31f42`.
- PR #429 — supplier payment allocation subledger — merged at `04ed847f726049f87055eafba079ce51e7cb2db4`.
- PR #431 — Web Cloud Print realtime wake hardening — merged at `8bbd03a1350305c0948decc1955cc7eced6ebce5`.
- Their financial/idempotency, supplier-allocation, print queue, Print Agent, KDS, routing, Realtime wake and offline protections are inherited unchanged by this track.

## Repository branch policy
Long-lived branches intentionally preserved:
1. `main`
2. `development/cleopatra-v811-final`
3. `development/smouha-v811-realtime-final`

Current temporary active development branch:
4. `performance/pos-product-browser-render-20261003`

## Safety fence
- السجل هو المرجع الإجباري للعمل، وهذا الملف يحدد المسار النشط الوحيد.
- CI يجب أن يفشل إذا السجل الإلزامي مفقود أو لا يطابق المسار النشط.
- Single writer on the active branch.
- No direct write to `main`.
- No force push.
- Unexpected branch HEAD or latest-main movement => **STOP_AND_RECONCILE**.
- لا Merge ولا Production migration قبل exact-head Full Verify Green + موافقة صريحة.
- No Production DB migration/write/data rewrite in this track.
- No RLS, Permission-First, branch isolation, accounting, sale/payment, offline, kitchen, KDS, printing, Print Agent, printer-routing or `send_to_kitchen` behavior change.
- No new dependency.
- No pagination/hiding/reordering of POS products.
- No merge until exact-head Full Verify Green + explicit approval.

## Current objective
Reduce POS runtime render/layout work without changing behavior:
1. keep all products/search/categories visible and functionally identical;
2. prevent cart/order-only parent rerenders from rebuilding the entire ~250-card Product Browser when catalog-facing props are unchanged;
3. stabilize the configure-product callback passed from `PosWorkspacePage`;
4. evaluate `products.edit` permission once per Product Browser render instead of once per product card;
5. normalize search text once per filtering pass;
6. let browsers skip offscreen card layout/paint using `content-visibility: auto` while preserving the full DOM and all product actions.

Detailed execution and evidence are maintained only in:
`docs/POS_PRODUCT_BROWSER_RENDER_PERFORMANCE_2026-10-03.md`

## Measured basis
- Cleopatra active products: 249.
- Smouha active products: 251.
- Largest category in each branch: 22 products.
- Product images already use `loading="lazy"`.
- Latest POS route chunk: ~68.7 KB gzip; download size is not the main observed concern.
- Current Production DB idle windows show no query/request storm.
- Historical heavy POS availability RPCs are either already optimized/applied or legacy and unused by current POS quantity gating.

## Definition of done
This track is complete only when:
- `ProductBrowser` is memoized with stable catalog-facing props;
- `PosWorkspacePage` no longer passes a new configure callback every render;
- offscreen product cards use browser-native content visibility;
- product card IDs/actions/search/category/image behavior remain unchanged;
- no DB/API/printing/KDS/payment/offline files are changed;
- exact-head Fast Verify + Full Verify + DB/security/RLS + Browser Smoke are Green;
- branch is reconciled with latest `main`;
- merge occurs only with explicit approval.

> Older work plans/logs are archival evidence only unless this file explicitly names them as active.
