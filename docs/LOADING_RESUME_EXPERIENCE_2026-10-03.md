# LOADING + POS RESUME EXPERIENCE — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/global-page-progress-20261003`
Current PR: `#438`
Last updated: 2026-10-03

## Work status
State: **BLOCKED**

Implementation is in Draft PR #438. Merge remains blocked until exact-head Full Verify is Green and explicit approval is given. No Production write or migration is part of this track.

## Guardrails
- No direct write to `main`; no force push.
- Unexpected branch/main movement => **STOP_AND_RECONCILE**.
- No Production schema/data/history mutation.
- Preserve Permission-First and `authorize_pos_order_access` as the first gate before loading an order workspace.
- No printing, Print Agent, KDS, settlement, inventory deduction, accounting, shift, or dashboard logic changes.
- Branch Pulse / user-error monitoring remains queued and is not implemented in this PR.

## Baseline
- Branch created from `main@c5015e7697fdcab8504c0de0cecd02d285cc8f1b`.
- App lazy routes use a shared `Suspense` fallback.
- Previous `PageLoader` was spinner-only on a full-page background.
- Protected routes reused that spinner while auth/roles were loading.
- Resuming an occupied-table order used:
  1. `authorize_pos_order_access`;
  2. order query;
  3. order-items query;
  4. products query.
- While that sequence ran, `CurrentOrderPanel` could render the existing order as an empty cart.

## Root-cause ledger
1. Page transitions had no explicit progress feedback, so users could mistake loading for a frozen system.
2. A fixed “real” percentage is unavailable for lazy chunks/auth/data, so the loader needs bounded perceptual progress tied to actual fallback lifetime.
3. POS resume did multiple sequential network reads after authorization.
4. The cart UI used the ordinary empty-cart state during resumed-order hydration.

## Change ledger
- Added `src/components/PageProgressLoader.tsx`:
  - starts at 0%;
  - advances quickly but never exceeds 92% while loading;
  - reaches 100% only when the fallback unmounts;
  - bilingual reassuring copy;
  - shared provider/fallback contract.
- Wired the provider at app level.
- Replaced lazy-route/auth-role spinner fallbacks with `PageLoadFallback`.
- Optimized `fetchOrderForWorkspace`:
  - keeps `authorize_pos_order_access` first;
  - then fetches order + order items + related products in one embedded query;
  - reduces resume path from four sequential round-trips to two.
- Added `pos-resume-order-loading` skeleton so an existing order never looks empty while its items are being restored.
- Added unit contracts:
  - `tests/unit/globalPageProgressContract.test.ts`;
  - `tests/unit/posResumeHydrationPerformanceContract.test.ts`.
- No Production write or migration.

## Verification ledger
- Branch initially matched main exactly.
- PR #438 opened as Draft.
- Exact-head CI after worklog synchronization: pending.

## Production gate
State: **BLOCKED**

No Production database application exists for this track. Merge requires exact-head Green CI + explicit approval.

## Next action
Run exact-head CI, fix only proven regressions, then reconcile PR #438 against latest `main`.

## Mandatory update protocol
- Re-read latest `main` and branch HEAD before repository writes.
- Unexpected divergence => **STOP_AND_RECONCILE**.
- Keep this log synchronized with material code/verification changes.
- Keep State **BLOCKED** until exact-head CI is Green and merge is explicitly approved.
