# VISIBLE DISPLAY READS — ACTIVE WORK LOG
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `perf/visible-read-coalescing-20261006`
Current PR: `#0`
Last updated: 2026-10-06

## Work status
State: **BLOCKED**
Prepare frontend read optimization; no Production apply or publishing in this scope.

## Guardrails
Single writer, selected project only. No migrations, RLS/Financial Visibility changes,
SECURITY DEFINER, stock/FIFO/accounting/settlement/shift/printing changes or live tests.
Usage Watch stays stopped. No repeated log polling. Fresh publishing approval required.

## Baseline
Main 70f25fe3c5e0411792ab9d7eb559424c9df047ad (#460 verified and deployed).
Separate isolated worktree. Unexpected head movement => STOP_AND_RECONCILE.

## Root-cause ledger
Screenshot usage is cumulative: Logs Query 402.3 GB, ingestion 2.11 GB, database
185 MB and egress 1.96 GB. At 10:48 UTC there was no queued application work or
lock wait. pg_stat_statements dates from Sep 1: historical totals cannot prove
current pressure. Recent KDS history only two API calls, 304 ms total. The old
product availability/cart availability reader is no longer wired into current POS;
do not optimize dead code or reintroduce obsolete stock gating.
Display realtime callbacks and KDS polling can still refresh hidden browser tabs.
KDS events and polling/manual refresh may overlap without a shared read cycle.

## Change ledger
Keep existing shared branch realtime subscriptions and server/RLS filters. Suppress
only display refresh callbacks while hidden; discard pending burst timers on hide.
On visibility return each current listener refreshes once, even if events were missed.
Initial POS/active badge and KDS queue reads are suppressed while hidden. Current
in-flight reads may complete; no abort of mutations. KDS coalesces same scope/station
reads into one active cycle and one trailing refresh; retains a final refresh for
events during reads, no fulfilled result cache, failed reads can retry, old scopes
discard results using existing guards. Printing, sync engine, discount approvals and
other operational timers/channels remain unchanged. Server realtime overhead remains;
this frontend patch targets downstream display reads rather than claiming to remove it.

## Verification ledger
Local targeted 13 tests passed, including visibility callbacks/cleanup, coalescing,
scope invalidation/retry, ten hidden polls and current KDS archive flows. Local
application/test type checks and changed-source lint passed; build pending.
Required exact-head Full Verify including full unit/DB/browser and Pages continuity.
Measured fixture reductions: ten overlapping requests -> two serialized reads;
ten hidden 30-second polls -> zero queue reads, one refresh on return. No live
CPU/log-ingest reduction is claimed before deployment and representative measurement.

## Production gate
State: **BLOCKED**
Frontend only. No database migration needed. No merge/deploy before exact-head
Full Verify green and explicit approval for this scope. Rollback frontend normally.

## Next action
Complete build, open draft PR and full verification, then request publishing approval.

## Mandatory update protocol
Check main/head before writes. Unexpected movement => STOP_AND_RECONCILE.
Record exact-head final CI in PR metadata without modifying the tested head.
