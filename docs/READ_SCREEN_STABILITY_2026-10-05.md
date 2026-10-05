# READ SCREEN STABILITY — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/stability-journal-20261005`
Current PR: `#447`
Last updated: 2026-10-05
Execution mode: **SINGLE_WRITER**

## Work status
State: **BLOCKED**
First patch implemented and uploaded as draft PR #447; deployment remains gated.

## Guardrails
User authorized incremental repairs with live branch continuity. No business-data writes,
Production SQL, schema/policy changes, transaction posting, POS, KDS, Print Agent or shift edits.
No merge before exact-head Full Verify Green and explicit approval. Keep Financial Visibility.

## Baseline
Main `f0b87cb384415b8b3e92f49637c3877003dfdf3c`, PR #446 merged/deployed,
Verify main completed successfully. Earlier audit display corrections are complete.

## Root-cause ledger
- Journal ignores the API error and presents unavailable data as an empty result.
- Search has no delay and superseded requests may overwrite newer scope results.
- All Journal rows are mounted in both desktop and mobile table bodies.

## Change ledger
- Scoped read hook clears data before paint and rejects old request/reload results.
- Search waits 300 ms; timers cancel on scope changes and unmount.
- Errors are translated using the existing user-facing helper and expose Retry.
- Journal summary cards show unavailable while loading/failed, not fabricated zero.
- Opt-in table paging limits Journal body rendering to 100 rows per page.
- Filtering, ordering, summary cards and export retain the complete loaded dataset.
- Existing unpaged tables retain their default behavior. No API/RPC signature changes.
- This bounds DOM rendering, not database response size; server paging is deferred.

## Verification ledger
- Local unit/component baseline: 287 files / 1407 tests passed.
- Final focused regressions and worklog gate: 3 files / 10 tests passed.
- Final typecheck:all, production build and changed-file lint passed.
- React hook/rendering review completed; no new lint warnings in changed files.
- Exact remote-head CI pending; record final evidence in PR before merge.

## Production gate
State: **BLOCKED**
No Production apply included. No merge/deploy has been performed in this track.

## Next action
Verify exact-head CI for draft PR #447 and obtain merge approval only after checks pass.
Follow with incremental report/dashboard and permission dependency patches.

## Mandatory update protocol
Single writer; check main/head before each remote write. Reconcile unexpected movement.
Update evidence and PR number before presenting the change for approval.
