# NAVIGATION + POS PERFORMANCE — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/navigation-pos-performance-20260925`
Current PR: `#370`
Last updated: 2026-09-25

## Work status

State: **BLOCKED**

Performance work only. Merge is blocked until exact-head Full Verify Green and explicit approval.

## Guardrails

- Single Writer only.
- No direct write to `main`.
- No force push.
- No Production migration in this phase.
- No printing / Print Agent / KDS / shift logic changes.
- Preserve permission-first, branch isolation, and history visibility.

## Baseline

- Base: `main@9762d6e094aebe3c8943ba394ade84c0486e5dac`.
- POS has persistent offline/catalog cache, but online startup waits for Supabase before showing cached products.
- App pages are route-level lazy chunks with no navigation prefetch.
- Mobile users experience visible delay during page transitions and POS order resume.

## Root-cause ledger

1. POS catalog is cache-capable but not cache-first while online.
2. Resuming an order can restore cart/order state before the product catalog query returns.
3. Route chunks are loaded only after navigation, adding network + parse delay before page data fetches begin.
4. Some page effects may reload when shared context identities change even if business scope is unchanged; must be measured before changing.

## Change ledger

- POS now hydrates branch-scoped cached products/categories/customers immediately while online.
- Online Supabase refresh still runs in the background and replaces cache only after successful data load.
- Existing branch-scoped cache filtering and offline safety remain intact.
- Added user-intent route chunk prefetch for common navigation targets on pointer/focus/touch; no eager all-page preload.
- Reviewed branch/settings shared caches; no speculative duplicate-reload rewrite applied without measurement.
- Added regression/performance contract tests.

## Verification ledger

- Exact-head Verify: pending.

## Production gate

State: **BLOCKED**

No Production migration planned. Merge requires exact-head Full Verify Green + explicit approval.

## Next action

Implement cache-first POS hydration with background refresh, then route prefetch, then verify duplicate reloads.

## Mandatory update protocol

- Check branch HEAD before every write.
- Unexpected HEAD = STOP_AND_RECONCILE.
- Update Change/Verification ledgers after each change group.
- No merge while State is BLOCKED.
