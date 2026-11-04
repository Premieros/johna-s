# CI runtime and duplicate-work repair
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `perf/ci-runtime-dedup-20261104`
Current PR: `0`
Last updated: 2026-11-04
State: **BLOCKED**

## Work status
Owner approved shorter verification and removal of redundant test work. Baseline mainf45b693/#604 is deployed. This change touches test/CI configuration only; no application behavior or database changes.

## Guardrails
Retain all frontend, database/RLS, accounting, sale/kitchen/printing and browser assertions. No production test transactions, dependency upgrade, new runtime price source or paid runner upgrade. Database suites remain serial in their owned CI Postgres. Code/config/unknown changes always require full verification; only a narrow docs allowlist can skip runtime jobs. Preserve exact-SHA and successful trusted-main deployment checks.

## Baseline
Verify41889062297:411 frontend files/2054 tests,236.13s unit wall time; cumulative environment428.84s/setup106.07s are not wall time. Browser136 tests/3.7min. Vitest4.1.11 removed environmentMatchGlobs, leaving the former Node-contract optimization ineffective. Browser uses two workers. Fast Verify already avoids duplicating an active same-head full PR check; preserve that existing guard. Full PR and main release checks remain.

## Root-cause ledger
Pure source/schema contracts unnecessarily load jsdom and React cleanup. A removed Vitest config option silently defeats previous intent. Browser jobs are a second critical path. Docs-only edits rerun all app/DB/browser/build gates. The early worklog test starts the whole Vitest environment before the same assertions run in the suite.

## Change ledger
Explicit Vitest4 projects partition an audited allowlist of pure Node tests from DOM tests; new unclassified tests keep their safe DOM default. Node setup omits React/DOM imports. No test/assertion is removed. Browser suite runs two shards with all cases retained and separate artifacts; the original browser-smoke required-check name aggregates both results. The Pages archive locator skips only positively identified non-publication jobs; a missing real publication/archive still blocks deployment. A native Node worklog fail-fast check replaces the duplicate early Vitest invocation. A verified SHA-bound scope artifact permits docs-only changes to skip runtime suites and app publication; missing/invalid scope data fails closed. Runtime tests/build/security gates remain unchanged for code/config changes.

## Verification ledger
Local full frontend run passed412 files/2059 tests in46.62s, retaining all2054 baseline tests plus5 scope checks; subsequent safety checks add2 archive cases and1 real multi-commit scope case (expected total2062 tests). This is local timing, not a comparison with GitHub hardware. Both browser shards enumerate68 cases each (136 total). Application/test typechecks and lint pass. Focused CI/asset/worklog checks pass24 cases across6 files after the final safety changes. The full local suite retained all baseline assertions. Exact-head Actions and measured runner timings remain pending. Need prove unchanged original test collection, both browser shards total136 and all DB cases retained. Do not claim a speed improvement before actual CI timings.

## Production gate
Only merge after exact-head full workflow success. This PR changes CI/config, so it takes the complete runtime path. Pages must validate the scope artifact from that exact successful trusted main run. No production SQL to apply.

## Next action
Complete checks, review diff and compare exact-head CI timing to the recorded baseline. Publish one verified change; record release evidence in the PR. Rollback reverts test/CI/config files only and never touches restaurant data.

## Mandatory update protocol
Record actual tests, elapsed times, current PR and release proof. Preserve all security/business coverage and distinguish local timing from GitHub runner timing. Do not disable isolation or parallelize the shared DB fixtures.
