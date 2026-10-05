# READ SCREEN STABILITY — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/stability-report-options-20261005`
Current PR: `#449`
Last updated: 2026-10-05
Execution mode: **SINGLE_WRITER**

## Work status
State: **BLOCKED**
PR #447 and #448 merged/deployed. Third filter-options patch is uploaded as draft PR #449; exact-head Full Verify is pending.

## Guardrails
User authorized incremental repairs with live branch continuity. No business-data writes,
Production SQL, schema/policy changes, transaction posting, POS, KDS, Print Agent or shift edits.
No merge before exact-head Full Verify Green and explicit approval. Keep Financial Visibility.

## Baseline
Main `b961c6e9f7457f1431ea4594e002de41a6a542a8`, PR #448 merged/deployed.
Exact-head Full Verify passed: run 37283975068. Deployment/API parity passed: run 37285120532.
Live login renders after reload; authenticated screens require sign-in. No Production writes.

## Root-cause ledger
- Journal ignores the API error and presents unavailable data as an empty result.
- Search has no delay and superseded requests may overwrite newer scope results.
- All Journal rows are mounted in both desktop and mobile table bodies.

- Reports also writes rows and summary separately without guarding superseded requests.
- Report load failures can reject without a visible error; profit/costing failures may show zero.
- Reports mounts every result twice (phone/desktop), although exports must retain full rows.

- Filter options retained previous branch values until the next request finished.
- Expense category requests could publish after switching branch; query failures looked like empty options.

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

### Third patch: filter options
- One user/branch/report scoped snapshot includes dimension options and expense categories.
- Clear before paint on scope change; superseded results and logged-out reads cannot publish.
- Propagate Supabase option errors to a translated filter-specific Retry UI.
- No report formulas, Run report semantics, query dimensions, print/export payloads or SQL changes.
- Regression coverage: late old-branch categories, scope clearing, logout, partial failure/retry, enabled-query error propagation and category deduplication.

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
- #448 exact-head Full Verify passed: 37286637621; Pages build/parity/deploy passed: 37287871740.
- Third patch focused regression/all-page smoke: 5 files / 50 tests passed.
- Third patch full unit/component suite: 290 files / 1418 tests passed.
- Final UI suite: 5 tests passed, including filter Retry without reloading successful report.
- Typecheck:all, production build, changed-file lint, DB identity and API contract passed.
- Branch-matching worklog/performance contracts: 9 tests passed.
- Public post-#448 login visible with no new site JavaScript errors; no authenticated transactions performed.
- Third patch remote exact-head CI pending; no deployment yet.

## Production gate
State: **BLOCKED**
No Production DB apply included. #448 deployed with user authorization; third filter-options patch is not deployed.

## Next action
Complete local verification, upload the isolated filter-options draft, then verify exact-head CI.
Follow with incremental report/dashboard and permission dependency patches.

## Mandatory update protocol
Single writer; check main/head before each remote write. Reconcile unexpected movement.
Update evidence and PR number before presenting the change for approval.
