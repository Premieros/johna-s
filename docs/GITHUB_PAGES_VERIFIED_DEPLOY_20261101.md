# GitHub Pages verified deployment gate and stock-count review service repair

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/github-pages-deploy-after-verified-main-20261101`
Current PR: #564
Last updated: 2026-11-02
State: **DEPLOYED**

## Work status

- Confirmed production release incident: GitHub Pages run [41432991067](https://github.com/Premieros/johna-s/actions/runs/41432991067) published `7938bc79c5ba96bee5213a8201f09393abb30042` at 11:00:34 UTC, while [Verify main 41432991040](https://github.com/Premieros/johna-s/actions/runs/41432991040) for the same SHA failed at 11:03:53 UTC.
- Candidate PR #564 now combines the Pages release gate and the stock-count review UI/service correction so that the review fix itself cannot be independently published through the unsafe push workflow.
- PR #564 merged as `d72208b6e8945448ab634885130ea1d5e8b4d13e` on 2026-11-02. The merged workflow now waits for successful `Verify main` before publishing the exact latest main SHA.
- Fresh full Verify main checks on the exact PR head are mandatory before merge. After merge, the first Pages deployment must be observed and its published SHA must equal the passing Verify main SHA.

## Guardrails

- No production Supabase writes, SQL migrations, schema or RLS changes.
- Do not apply stock counts, move inventory, write journals, alter debts, or change FIFO records.
- Keep stock-count price review read-only and use the existing canonical `get_raw_material_current_prices` RPC; no new price source or calculation path.
- Do not merge or publish unless all four mandatory Verify main jobs pass on the exact combined PR head.

## Baseline

- Repository: `Premieros/johna-s`; production database identity: `azzdesuowpdcoflmyezn`.
- Baseline main SHA at candidate consolidation: `7938bc79c5ba96bee5213a8201f09393abb30042`.
- Last published SHA at incident capture: `7938bc79c5ba96bee5213a8201f09393abb30042`.
- The Pages workflow was `.github/workflows/deploy.yml`; production frontend is GitHub Pages, not Vercel.

## Root-cause ledger

- `.github/workflows/deploy.yml` published on `push` independently of the full `Verify main` workflow. Build and production API parity alone could not prove lint, TypeScript, unit, database/RLS, browser, and Pages continuity suites passed.
- The deployed main SHA failed TypeScript in `StockCountsPage.tsx`: Supabase returned a `PromiseLike` object on which page code called `.catch()`.
- An initial repair fixed the PromiseLike typing but still called the RPC directly from the page, violating the existing page-data-access boundary. The correct root fix is to await the thenable inside the feature service and expose a native async Promise to the page.
- The first PR #564 work-log candidate also failed the repository's mandatory worklog contract because it omitted required structural headings. This log restores the required contract; tests remain mandatory and unchanged.

## Change ledger

- Restrict Pages to completed successful `Verify main` workflow runs for same-repository `push` events on `main`/`master`; remove direct push and manual publication routes.
- Build, production-parity and deploy check out the exact verified `workflow_run.head_sha`; reject stale branch HEAD before build and again immediately before deploy.
- Preserve current API parity checks, the existing GitHub Pages environment and previous assets for active sessions. Asset retention uses `workflow_run.head_branch`.
- Move `get_raw_material_current_prices` from `StockCountsPage.tsx` into `loadStockCountReviewPrices` in `src/features/inventory/services/stockCountData.ts`. Keep it read-only and scoped to the selected branch/raw-material IDs.
- Preserve explicit numeric zero and unknown `NULL` as distinct values; propagate service errors to the page.
- Add focused unit coverage for PromiseLike behavior, zero versus NULL, canonical RPC arguments and error propagation, plus the Pages verified exact-SHA gate contract.

## Verification ledger

- Historical failed release evidence: Pages [41432991067](https://github.com/Premieros/johna-s/actions/runs/41432991067) succeeded before Verify [41432991040](https://github.com/Premieros/johna-s/actions/runs/41432991040) failed for the same SHA.
- An earlier PR #564 candidate run [41400627705](https://github.com/Premieros/johna-s/actions/runs/41400627705) passed all four jobs, but was based on an older main SHA and is not sufficient for this consolidated update.
- The first current-main PR #564 check [41502335390](https://github.com/Premieros/johna-s/actions/runs/41502335390) failed only the mandatory worklog structure test; the DB, browser and Pages continuity jobs were still running when inspected. The worklog is corrected here without weakening the test.
- Pre-merge exact-head Verify run [41503707643](https://github.com/Premieros/johna-s/actions/runs/41503707643) passed all four required jobs: `verify`, `db`, `browser-smoke`, and `pages-continuity`.
- Post-merge Verify main run [41504922276](https://github.com/Premieros/johna-s/actions/runs/41504922276) passed all four jobs for merge SHA `d72208b6e8945448ab634885130ea1d5e8b4d13e`.
- GitHub Pages deployment [41505828369](https://github.com/Premieros/johna-s/actions/runs/41505828369) completed successfully after Verify and deployed the same SHA. `build`, `production-parity`, and `deploy` all succeeded.

## Production gate

- **Merged and deployed.** PR #564 is merged and GitHub Pages run #41505828369 succeeded for the same SHA that passed post-merge Verify #41504922276.
- Main SHA: `d72208b6e8945448ab634885130ea1d5e8b4d13e`.
- Supabase migration status is separate. This PR contains no migration; no production database action was taken.

## Next action

Run full Verify main on the latest combined PR head. Diagnose and correct any test failures without deleting or weakening coverage. After all four jobs pass, review the workflow_run permissions/event semantics, merge PR #564, then verify the first Pages publish SHA and ordering.

## Mandatory update protocol

Update this log for each material finding and check result. Keep code merge, GitHub Pages publication and Supabase migration status separate. CI must fail when the mandatory log is missing or incomplete. Never claim production release before Pages confirms the exact verified commit.
