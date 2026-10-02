# POS PRODUCT BROWSER RENDER PERFORMANCE — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `performance/pos-product-browser-render-20261003`
Baseline: `main@8bbd03a1350305c0948decc1955cc7eced6ebce5`
Last updated: 2026-10-03

## Work status
State: **BLOCKED**

## Baseline
- Latest `main`: `8bbd03a1350305c0948decc1955cc7eced6ebce5`.
- No open pull requests existed at branch creation.
- Production DB is currently idle/healthy in read-only measurements.
- Cloud Print 700ms polling repair is merged/deployed and remains frozen.
- PR #428 financial idempotency and PR #429 supplier allocation protections are inherited from main unchanged.

## Root-cause ledger
1. Both live branches currently have about 250 active POS products (Cleopatra 249, Smouha 251).
2. The largest single category is only 22 products, so the main worst case is the default/all-products view.
3. `ProductBrowser` currently renders every filtered product card eagerly in one grid.
4. `PosWorkspacePage` rerenders frequently as cart/order state changes.
5. `ProductBrowser` is not memoized.
6. `PosWorkspacePage` passes an inline `onConfigureProduct={(p) => setConfigProduct(p)}`, creating a new function on every parent render and preventing a shallow memo boundary.
7. `pos.addToCart` is already stable via `useCallback`, so stabilizing the remaining callback plus memoizing the browser can suppress unnecessary 250-card rebuilds during cart/order-only rerenders.
8. Product images already use `loading="lazy"`; network image eagerness is not the primary issue.
9. Latest production bundle sizes are reasonable; the POS route is ~68.7 KB gzip. The issue is therefore more plausibly runtime render/layout work than download size.
10. Historical heavy DB RPCs inspected during this audit are either already optimized/applied or legacy and unused by current POS quantity gating.

## Guardrails
- Frontend-only performance work.
- No Supabase migration, Production DB write, RLS change, API contract change, or data rewrite.
- Do not change POS business behavior, product order, search semantics, category semantics, pricing, permissions, cart mutations, checkout, kitchen send, payment, offline, KDS, printing, Print Agent, or printer routing.
- Do not add pagination or hide products.
- Preserve all existing product card test IDs and click handlers.
- Preserve image upload/adjust behavior and permissions.
- No new dependency.
- No direct writes to `main`, no force push.
- Unexpected branch HEAD or main movement => **STOP_AND_RECONCILE**.
- Merge only after exact-head Full Verify Green and explicit merge approval.

## Change ledger
Implemented:
- Memoized `ProductBrowser` so stable catalog props can reuse the full browser subtree during unrelated parent/cart state changes.
- Stabilized `onConfigureProduct` in `PosWorkspacePage` with `useCallback`.
- Evaluates `products.edit` once per browser render instead of once per product card.
- Normalizes search text once per filter pass without trimming or changing search semantics.
- Added `content-visibility: auto` plus intrinsic card size so offscreen cards can skip layout/paint while all products remain in the DOM.
- Added `posProductBrowserRenderPerformanceContract.test.ts` to lock memoization, callback stability, single permission evaluation, full-product mapping, content visibility and action identity.
- No pagination, product hiding, product reorder, API/DB call, pricing, cart, checkout, kitchen, KDS, printing or offline behavior change.

## Verification ledger
- Production active product counts measured read-only: Cleopatra 249, Smouha 251.
- Largest category measured read-only: 22 products in each branch.
- Production DB idle checks: no blocked locks; no idle claim polling storm.
- Latest build bundle reviewed.
- Implementation: complete on branch.
- Unit contract: added; CI pending.
- Branch diff verified against latest main: only CURRENT_WORK_PLAN, active worklog, ProductBrowser, PosWorkspacePage and the new unit contract are changed.
- Fast Verify: pending.
- Full Verify / DB / Browser Smoke: pending.
- Production migration: none by design.
- Deploy: pending merge approval.

## Production gate
State: **BLOCKED**
- No Production DB action exists in this track.
- Runtime exposure occurs only through normal frontend merge/deploy.
- Before merge: exact-head Full Verify must be Green and branch/main must be reconciled.
- After deploy: verify POS smoke and print/financial safety gates remain Green.
- Rollback is frontend deployment rollback only.

## Definition of done
- Cart/order-only rerenders can reuse a memoized `ProductBrowser` when catalog-facing props are unchanged.
- `onConfigureProduct` is stable across parent rerenders.
- Offscreen product cards use browser-native content visibility without removing products from the DOM.
- Product search/category/add/configure/image behavior is unchanged.
- No DB/API/printing/KDS/payment/offline files changed.
- Exact-head Fast Verify and Full Verify including DB/security/RLS and Browser Smoke are Green.
- Merge occurs only with explicit approval.

## Mandatory update protocol
- Re-read latest `main` and expected branch HEAD before every repository write.
- Unexpected HEAD or main divergence => **STOP_AND_RECONCILE**.
- Single writer on this branch.
- Update this log after material implementation/verification changes.
- Keep State **BLOCKED** until exact-head Full Verify Green and merge approval.

## Next action
Open a Draft PR, run exact-head Fast Verify + Full Verify, reconcile any failure without broadening scope, then request explicit merge approval only after every gate is Green.
