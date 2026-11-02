# GitHub Pages verified exact-commit deployment gate — 2026-11-02

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/github-pages-deploy-after-verified-main-20261101`
Current PR: #564
Last updated: 2026-11-02
State: **BLOCKED — PR review and fresh exact-head CI required**

## Confirmed production incident

On 2026-11-02, GitHub Pages deployment run [41432991067](https://github.com/Premieros/johna-s/actions/runs/41432991067) successfully published commit `7938bc79c5ba96bee5213a8201f09393abb30042` at 11:00:34 UTC. The independent [Verify main run 41432991040](https://github.com/Premieros/johna-s/actions/runs/41432991040) for the same SHA completed **FAILURE** at 11:03:53 UTC.

Root cause in the verification job: `src/features/inventory/pages/StockCountsPage.tsx:88` called `.catch()` on Supabase's `PromiseLike<void>`, producing TS2339. The `db`, `browser-smoke`, and `pages-continuity` jobs passed; `verify` failed during TypeScript, so its later unit/build steps were skipped. This is direct evidence that the currently published SHA did not pass the complete mandatory verification suite. It does not, by itself, prove a runtime user-facing failure.

The current `main` head and last successful Pages deployment both reference `7938bc79c5ba96bee5213a8201f09393abb30042`. The workflow on main still has an independent `push` trigger, so the release-gate defect remains live.

## Root cause

`.github/workflows/deploy.yml` independently runs on push and performs build/API parity only. It does not depend on the four mandatory `Verify main` jobs (unit/type/lint/build, DB + integration/RLS, browser smoke, Pages continuity). Therefore Pages can publish a SHA before, or even when, full Verify main fails.

## Candidate change

- Trigger Pages only from a completed successful `Verify main` workflow run for a same-repository `push` on `main`/`master`.
- Remove independent `push` and manual dispatch publication paths.
- Build and run production parity against the exact verified `workflow_run.head_sha`.
- Compare remote branch HEAD to the verified SHA before building and immediately before deployment, refusing stale runs.
- Preserve production API parity, active-session asset retention, and the `github-pages` environment.
- Add a small unit contract for event filtering, mandatory jobs, exact-SHA checkout, stale-SHA checks and deploy dependencies.

## Verification and release controls

Previous candidate run [41306038311](https://github.com/Premieros/johna-s/actions/runs/41306038311) passed all four jobs on its then-current SHA, but that SHA predates current main and is not sufficient for this update. The PR is rebased onto current main `7938bc79c5ba96bee5213a8201f09393abb30042`; its new exact-head Verify main must pass all four jobs before review/merge.

After merge, verify a fresh `Verify main` push succeeds first, then verify the resulting Pages deployment publishes the identical SHA. Merge, Pages publication and Supabase migrations are separate events.

## Guardrails

CI/workflow and documentation only. No production SQL, schema migration, RLS/permission change, inventory movement, count application, FIFO debt or accounting mutation. Do not merge or publish until fresh exact-head checks pass and the workflow event/permission semantics are reviewed.
