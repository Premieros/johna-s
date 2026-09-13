# PR7 — Confirmed Legacy Cleanup Closure

Date: 2026-09-13

## Scope

PR7 removes confirmed legacy Subscription/Billing runtime and UI references only after proving they are no longer part of the supported product flow.

Original baseline: `main@2ba3deab61b519a6950656efb4badbc1880f4e19`
Branch: `development/pr7-confirmed-legacy-cleanup`
PR: #105
Merged main commit: `433ff97d9dd4425df74e82f65170497bfd28bab2`

## Mandatory legacy-removal rule

PR7 was the **last cleanup stage after proving that the old code was unused by the supported flow**.

No legacy code was eligible for removal merely because it looked old. The required sequence was:

`usage proof -> replacement proof -> regression coverage -> removal -> Full Verify`

Meaning:

1. prove the old runtime/path is not used by the supported product flow;
2. prove required behavior is preserved by the current replacement, or that the cancelled path has no supported use;
3. add regression coverage that would catch accidental reintroduction/dependency;
4. remove only the confirmed-dead legacy runtime/UI;
5. run Full Verify before merge and Verify/Deploy again after merge.

This rule remains a standing guardrail for any future legacy cleanup.

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
- Parallel work such as printer-agent work remained separate.

## Pre-merge verification

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

The final PR head later passed the normal PR verification on GitHub's virtual merge result with the then-current main, preserving the already-merged parallel PR #103 work.

## Merge and post-merge proof

PR #105 was merged only after the user explicitly approved the merge and after re-fetching current `main` and the PR head.

Merged result:

- `main@433ff97d9dd4425df74e82f65170497bfd28bab2`
- Verify main #1286: **Full Green**
  - lint
  - app typecheck
  - test-suite typecheck
  - unit tests
  - build
  - Fresh DB canonical migrations
  - schema verification
  - integration + security/RLS regression
  - Browser Smoke / Playwright
- Deploy #630: **Green**
  - build
  - locked Supabase identity
  - frontend API contract
  - Production API parity
  - GitHub Pages deploy

Production was not used as a test environment and no Production migration/data rewrite was performed for PR7.

## Final status

PR7 / Confirmed Legacy Cleanup is **CLOSED + MERGED + POST-MERGE VERIFIED**.

Do not reopen it or remove additional historical/legacy code without a new, independently proven regression/usage case and the same evidence chain:

`usage proof -> replacement proof -> regression coverage -> removal -> Full Verify`.
