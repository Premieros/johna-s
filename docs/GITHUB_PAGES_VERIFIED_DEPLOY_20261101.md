# GitHub Pages verified exact-commit deployment gate — 2026-11-02

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/github-pages-deploy-after-verified-main-20261101`
Current PR: #564
Last updated: 2026-11-02
State: **BLOCKED**

## Work status

PR #564 contains a CI-only GitHub Pages release gate. It must not merge or publish until the current exact-head Verify main succeeds and the event/permission semantics receive review. No Supabase migration or financial code is included.

## Guardrails

Do not merge until exact PR-head Verify main passes all four jobs (application/unit/type/lint/build, DB/integration/RLS, browser smoke, Pages continuity). Do not publish a stale or unverified commit. Preserve production API parity, previous Pages assets for active sessions and the `github-pages` environment. No production SQL, customer stock writes, inventory adjustment, FIFO debt or accounting mutation.

## Baseline

On 2026-11-02, GitHub Pages deployment run [41432991067](https://github.com/Premieros/johna-s/actions/runs/41432991067) successfully published main commit `7938bc79c5ba96bee5213a8201f09393abb30042` at 11:00:34 UTC. The independent [Verify main run 41432991040](https://github.com/Premieros/johna-s/actions/runs/41432991040) for the same SHA completed **FAILURE** at 11:03:53 UTC. Earlier main commit `cf468bd29305e236d68df41dc95ce192a9568071` also had a failing Verify main run [41432002325](https://github.com/Premieros/johna-s/actions/runs/41432002325).

For both failing commits, the root error was TS2339 at `src/features/inventory/pages/StockCountsPage.tsx:88`: `.catch()` was called on Supabase's `PromiseLike<void>`. The `db`, `browser-smoke`, and `pages-continuity` jobs passed; the `verify` job failed during TypeScript, so later unit/build steps were skipped. This proves the deployed SHA did not pass complete mandatory verification; it does not prove a runtime user-facing failure.

## Root-cause ledger

The production `.github/workflows/deploy.yml` on main independently triggers on `push` and performs its own build/API parity. It does not depend on all four mandatory `Verify main` jobs. Therefore it can publish before verification completes or even when full verification fails.

## Change ledger

- Change Pages trigger to completed successful `Verify main` workflow runs from same-repository `push` events on `main`/`master`.
- Remove independent direct-push and manual publication triggers.
- Build and run production parity against the exact verified `workflow_run.head_sha`.
- Compare remote branch HEAD with the verified SHA before build and immediately before deploy; refuse stale runs.
- Preserve API parity, active-session asset retention and the existing Pages environment.
- Add a small unit contract for event filtering, required jobs, exact-SHA checkout, stale-SHA checks and deploy dependencies.

## Verification ledger

Previous candidate [Verify main 41306038311](https://github.com/Premieros/johna-s/actions/runs/41306038311) passed all four jobs on an older SHA, but that SHA predates current main and is not evidence for this rebased update.

Rebased candidate head: `23ff3f7f7d7ec82cb71bf04129c631f7423ff715`, parent/current main: `7938bc79c5ba96bee5213a8201f09393abb30042`. Its new exact-head Verify main is [41502335390](https://github.com/Premieros/johna-s/actions/runs/41502335390). The first attempt failed the mandatory worklog contract because the active plan did not point to this log and required headings were missing; corrected both in the next commit. Fresh exact-head verification is required again.

## Production gate

**BLOCKED** until all four mandatory checks pass on the updated PR head and a reviewer confirms workflow_run event semantics and least-privilege permissions. After merge, verify a fresh successful main Verify run is followed by a Pages deployment of that identical SHA. Merge, GitHub Pages publication and Supabase migrations are separate events.

## Next action

Run the corrected PR-head Verify main, inspect every job, review workflow_run permissions and publication ordering, then await human approval. After any approved merge, independently verify Pages deployment SHA and status. Do not apply any Supabase migration.

## Mandatory update protocol

Update this log for material findings and exact CI evidence. Keep code merge, GitHub Pages publish and Supabase migrations separate. Never claim a production release without a successful GitHub Pages deployment for the tested exact SHA.
