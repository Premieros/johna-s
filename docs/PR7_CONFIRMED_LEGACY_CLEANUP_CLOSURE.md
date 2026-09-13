# PR7 — Confirmed Legacy Cleanup Closure

Date: 2026-09-13

## Scope

PR7 removes confirmed legacy Subscription/Billing runtime and UI references only after proving they are no longer part of the supported product flow.

Baseline: `main@2ba3deab61b519a6950656efb4badbc1880f4e19`
Branch: `development/pr7-confirmed-legacy-cleanup`

## Changes

- Removed live `/subscription` and `/subscriptions` routes and route constants.
- Removed subscription loading from auth/bootstrap.
- Removed the subscription API/domain exports and shared subscription types.
- Removed dead subscription pages, components, hooks and services after callers were disconnected.
- Removed the legacy subscription/trial/payment UI from Settings Control Center while preserving the remaining settings sections.
- Removed the obsolete navigation permission exception for subscription.
- Replaced the old subscription behavior unit contract with a regression contract asserting that legacy subscription runtime does not return.
- Refreshed the generated frontend API contract to match current frontend references only.

## Safety

- No Production write.
- No Production migration.
- No historical migration deletion.
- No table/RPC deletion from Production.
- No reset, reseed, backfill or rewrite of user/business data.
- No RLS or Permission-First weakening.
- No POS/Kitchen/Payments/Inventory business-rule change.
- PR #103 and PR #78 remain separate workstreams.

## Verification

Implementation head `35e59c0f273c1557a69ab75060054efca103d5fd` passed Verify #1279 Full Green:

- locked Supabase identity
- frontend API contract
- lint
- app and test-suite typecheck
- unit tests
- build
- Fresh DB canonical migrations
- schema verification
- integration + security/RLS regression
- Browser Smoke / Playwright

The temporary branch-only Verify trigger was then removed and `.github/workflows/verify-main.yml` restored exactly to the `main` version in commit `3ba94bacd1639cac8d2d2e46eae6920bb3430adc`.

Because this closure document changes the branch HEAD after Verify #1279, the pull request must pass the normal PR-triggered Full Verify on the final head before merge.

## Merge gate

Do not merge PR7 until:

1. current `main` and branch HEAD are re-fetched;
2. PR is mergeable with no conflicting parallel work;
3. PR-triggered Verify is Full Green;
4. the user explicitly says `ادمج`.
