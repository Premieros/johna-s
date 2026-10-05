# READ SCREEN STABILITY — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/stability-reports-20261005`
Current PR: `#0` (new report patch not yet opened)
Last updated: 2026-10-05
Execution mode: **SINGLE_WRITER**

## Work status
State: **BLOCKED**
PR #447 merged/deployed; the second report patch is implemented locally and not deployed.

## Guardrails
User authorized incremental repairs with live branch continuity. No business-data writes,
Production SQL, schema/policy changes, transaction posting, POS, KDS, Print Agent or shift edits.
No merge before exact-head Full Verify Green and explicit approval. Keep Financial Visibility.

## Baseline
Main `d7e62ecd5b2a95c6239cf2c1dd6aa5ea983e06b0`, PR #447 merged/deployed.
Exact-head Full Verify passed: run 37283975068. Deployment/API parity passed: run 37285120532.
Live login renders after reload; authenticated screens require sign-in. No Production writes.

## Root-cause ledger
- Journal ignores the API error and presents unavailable data as an empty result.
- Search has no delay and superseded requests may overwrite newer scope results.
- All Journal rows are mounted in both desktop and mobile table bodies.

- Reports also writes rows and summary separately without guarding superseded requests.
- Report load failures can reject without a visible error; profit/costing failures may show zero.
- Reports mounts every result twice (phone/desktop), although exports must retain full rows.

## Change ledger
- Scoped read hook clears data before paint and rejects old request/reload results.
- Search waits 300 ms; timers cancel on scope changes and unmount.
- Errors are translated using the existing user-facing helper and expose Retry.
- Journal summary cards show unavailable while loading/failed, not fabricated zero.
- Opt-in table paging limits Journal body rendering to 100 rows per page.
- Filtering, ordering, summary cards and export retain the complete loaded dataset.
- Existing unpaged tables retain their default behavior. No API/RPC signature changes.
- This bounds DOM rendering, not database response size; server paging is deferred.

### Second patch: reports
- Existing report calculations collect one local rows/summary snapshot; only the latest scoped
  read can publish it. No RPC signatures, SQL, visibility predicates or numeric formulas change.
- Preserve explicit Run report: draft date/filter edits do not send new report requests.
- Propagate previously ignored income/costing RPC errors to translated Retry UI.
- Show unavailable totals during load/failure, and prevent printing/exporting unavailable data.
- Render 100 screen rows per page; print, CSV and Excel still read all loaded rows.
- Preserve existing print payload generation, formatting and Print Agent paths.
- Four component regression tests exercise race, failure/retry, manual filter application,
  and full 205-row print/export after navigating the last screen page.

## Verification ledger
- Local unit/component baseline: 287 files / 1407 tests passed.
- Final focused regressions and worklog gate: 3 files / 10 tests passed.
- Final typecheck:all, production build and changed-file lint passed.
- React hook/rendering review completed; no new lint warnings in changed files.
- #447 exact-head CI passed and user approved merge; its deployment is complete.
- Report patch: final unit/component suite passed, 288 files / 1412 tests.
- Focused report/contract/worklog checks passed (23 tests); all-page smoke passed.
- Final typecheck:all, build, changed-file lint, DB identity and API contract passed.
- Report screen pagination ties its page to the snapshot, avoiding an effect-reset/click race.
- Remote exact-head Full Verify remains pending.

## Production gate
State: **BLOCKED**
No Production DB apply included. #447 deployed with approval; the report patch is not deployed.

## Next action
Finish report validation, open a separate draft PR and verify its exact-head CI before deployment.
Follow with incremental report/dashboard and permission dependency patches.

## Mandatory update protocol
Single writer; check main/head before each remote write. Reconcile unexpected movement.
Update evidence and PR number before presenting the change for approval.
