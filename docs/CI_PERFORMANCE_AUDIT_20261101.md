# CI performance and duplicate-test audit — 2026-11-01
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `perf/ci-unit-node-contracts-20261101`
Current PR: #566
Last updated: 2026-11-01
State: **BLOCKED**

## Work status
Owner requested analysis and removal/restructuring of redundant or unnecessarily expensive tests that delay fixes and GitHub Pages releases. GitHub-hosted Johna's has two separate workflows: `Verify main` and `Deploy to GitHub Pages`. Optimization is intentionally narrow, retaining every accounting/inventory/RLS regression.

## Guardrails
Do not disable mandatory database, permissions, unit/component or browser test coverage. CI PostgreSQL is disposable GitHub Actions Postgres 16, not production Supabase. No production inventory data writes, migrations, customer test fixtures or deployment changes in this PR. Do not present estimated speedup as proven before exact-head CI and measured timings.

## Baseline
Measured exact-head all-green Verify main #4576 (2026-10-31):
- `verify` job ~360 s, of which `npm run test:unit` about **235 s** across **404 test files / 2,011 tests**. Vitest cumulative virtual jsdom environment time 422 s; actual test execution total 63 s. CI 2-core runner and overlapping workers mean those cumulative sums are NOT job elapsed time.
- `browser-smoke` job ~330 s, Playwright **136 tests in ~4.3 min**; 36-ish unauthenticated routes and ~49 authenticated route/button journeys. They protect different flows and are not safe to delete as duplicates.
- `db` job ~193 s, **216 integration files / 1,183 tests in ~134 s**; serial files intentionally protect shared PostgreSQL/RLS/ledger fixture state.
- `pages-continuity` ~77 s, checks retention of old hashed assets required by still-open POS sessions.
- `npm ci` roughly 35–53 s per verify job. GitHub Actions setup-node npm cache already active; it caches npm download data, not a shared node_modules directory.
- Vite build repeats in `verify`, `pages-continuity`, `browser-smoke` (~10 s each) and on actual Pages deploy; however independent jobs are parallel and reusing build artifact as a prerequisite could lengthen critical path, so do not naively serialize them.
- `activeWorklogGateContract` is run twice within `verify` (early fail-fast then the full unit suite), cost about 2 s. This duplication is intentional fail-fast and saves expensive later steps on broken work logs, so **retain** unless an equal fail-fast mechanism replaces it.
- Deployment currently runs independently of full Verify main. PR #564 separately introduces exact verified SHA gating; avoid merging an overlapping workflow change in this PR.

## Root-cause ledger
The longest repeatable job is the unit suite, not database tests. A majority of `tests/unit/*Contract.test.ts` checks source/SQL/static patterns, but previously each paid jsdom startup and global DOM polyfill setup. Tests that actually render React or need browser APIs must remain on jsdom. We must prove which files can use Node.

## Change ledger
- `vitest.config.ts`: direct `tests/unit/**/*Contract.test.ts` to Vitest `node` environment while leaving other unit/hook and all `tests/components` in jsdom.
- `tests/setup.ts`: conditionally run React DOM cleanup and window.matchMedia polyfill only when `window` is available; still restore mocks for every test.
- **No tests or assertions removed.** CI will identify any Contract suite that genuinely needs DOM; those must be expressly restored to jsdom rather than weakening assertions or changing behavior.

## Verification ledger
Source audit: many sampled source-contract files import only `vitest`, `node:fs` and `node:path` and inspect static code. Some contracts import browser-facing utility modules, so this is **experimental until full CI green**. Exact-head CI and measured wall-time comparison pending.

## Production gate
**BLOCKED**. Only merge when every `Verify main` job is green with the same 2,011 unit/1,183 integration/136 browser tests (modulo independently changing baseline on main) and a reproducible time improvement. If unsafe/unsupported glob behavior or failures appear, constrain to an explicit audited allow-list or revert. No release changes or database mutation.

## Next action
Inspect CI failures; preserve DOM-required contracts using explicit exceptions. Record new `test:unit` duration and compare to baseline ~235 s, with green database and browser gates. Then consider independent browser route fixture reuse without dropping security or navigation assertions.

## Mandatory update protocol
Update this active worklog after substantive changes or verified CI. Do not claim a speedup from an unmeasured experiment. No Merge until exact-head full CI passes.
