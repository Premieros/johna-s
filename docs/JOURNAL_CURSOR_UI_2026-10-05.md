# JOURNAL CURSOR UI — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/journal-cursor-ui-20261005`
Current PR: `#0`
Last updated: 2026-10-05
Execution mode: **SINGLE_WRITER**

## Work status
State: **BLOCKED**
Approved database-only #453 applied and merged. Frontend patch requires exact-head Full Verify.

## Guardrails
No new migrations/policy changes, live business-data edits, real sales or print tests.
Preserve Financial Visibility, Permission-First, branch isolation and posting/POS/KDS/Print Agent.
Single writer; no direct main writes, no force push; unexpected movement STOP_AND_RECONCILE.

## Baseline
Main a2710f03ec23f7b5711e85cfe045c020e175a44a. User explicitly approved new read function at
17:18 Cairo. Applied journal_page_read (version 20261005141910); stable SECURITY INVOKER; authenticated/service_role
execute only (PUBLIC/anon revoked). Safe NULL-branch read passed. All existing function and
journal/chart policy hashes unchanged. Pages deployment 37323787272 passed.

## Root-cause ledger
The screen still calls unbounded legacy get_journals even though 100 rows are rendered.
Server paging must retain complete summary totals and discard foreign/obsolete cursors.

## Change ledger
Use approved get_journals_page with page size 100; keep only current detail rows plus cursor
history. Derive first page immediately for branch/user/filter changes, reset navigation before
paint, discard late reads through existing useLatestRead. Show full server totals and unavailable
cards on read failure/loading. Retry current first page or reset navigation after posting.
Preserve manual posting payload, account reads, permissions and detail modal; close old detail
on scope changes. No print/export flow exists on this Journal screen; reports unchanged.
One Previous/Next pager; do not show a second client pager for already bounded rows.
Column filters/sorting now concern the current page; retain them and explain this in-screen.
Main search/date/reference/branch filters and totals concern the complete authorized period.
No new SQL or dependency changes. API contract includes the already deployed function.

## Verification ledger
Actual hook regressions: bounded RPC and complete totals, cursor changes, scope reset including
return to an old branch, delayed read discard, errors/retry/invalid response, refresh and logout.
Actual screen regressions: full period cards after navigation, entry detail and immediate user
scope invalidation. Focused hook/screen suite passed: 2 files / 8 tests. Page/design/worklog
smoke passed: 3 files / 58 tests. Typecheck:all, changed-file lint, build, API contract (158
RPCs/54 tables) and diff checks passed. Exact-head Full Verify required.

## Production gate
State: **BLOCKED**
No database apply included. Require current main/head reconciliation and exact-head Full Verify
before frontend merge/deploy. Preserve immutable assets for active sales/printing sessions.

## Next action
Complete local checks, upload isolated frontend PR, pass exact-head CI, merge/deploy within
approved incremental scope, then perform safe read-only post-deploy checks.

## Mandatory update protocol
Check remote main/head before mutations; unexpected movement STOP_AND_RECONCILE. Bind actual
PR number and verification evidence before merge. Record completion in PR metadata without
invalidating the tested source head.
