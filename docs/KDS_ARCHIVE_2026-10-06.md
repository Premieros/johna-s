# KDS ARCHIVE AND EMPTY VOIDED ORDER — ACTIVE WORK LOG
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/kds-40-minute-archive-20261006`
Current PR: `0`
Last updated: 2026-10-06

## Work status
State: **BLOCKED**
User requests 40-minute active display, a completed-history location, and repair of
finishing the voided empty kitchen order. Prepare and verify before fresh approval.

## Guardrails
Single writer; no direct main writes, no force push, no unrelated project/database.
Preserve all RLS/Financial Visibility/station guards. New APIs are SECURITY INVOKER.
No automatic historic updates. No live transactions, sends, cleanup clicks or print tests.
No Print Agent, FIFO, settlement, shifts, sales or financial mutations in the patch.
Usage Watch stays stopped. Production is read-only while preparing this new scope.

## Baseline
Main 8bb7f48b8bbed93e2721600a0e134ea81d3748a0 (#459 deployed); post-merge
Verify 37441343533 and Pages 37441343568 succeeded. Separate worktree.

## Root-cause ledger
KDS currently keeps all unfinished orders, including legacy empty orders, visible.
Completed kitchen states disappear without a completed-history view.
Read-only Production logs at 09:37 UTC show KDS_STATION_ACCESS_DENIED from
set_kitchen_status (not a queue refresh/transport failure). The screenshot order
01756 is paid/completed, cooking, station main, with zero items and sends; the
operator has kit/bar/cashier assignments and no main assignment. Ordinary write
station guards are retained. An explicit tighter administrative empty-void cleanup
is proposed; it cannot finish active/non-voided/remaining-item orders.

## Change ledger
Local timer splits existing queue at >=2400 seconds since returned kitchen send
time, without new polling/writes; older items remain operable in their own tab.
Lazy 100-row served/cancelled history is invoker, date/branch/station/RLS scoped.
A separate invoker administrative cleanup requires settings.manage + kds view/update,
branch/RLS and complete item/send visibility, locks the order, accepts only closed
cancelled or paid/voided empty orders, changes kitchen_status/updated_at only, audits.
No ordinary status/station/dispatch function is changed. No automatic cleanup performed.
Scoped reads discard obsolete branch/user results; message mapping explains station denial.

## Verification ledger
Local component boundary/archiving/lazy/error/scope tests and integration fixtures
prepared. Required: exact-head full unit/types/build, isolated history RLS/paging and
cleanup state/permission/non-empty/idempotence/stock/print/accounting checks, browser.

## Production gate
State: **BLOCKED**
No migration applied, merge or publishing authorized for this new scope. Requires
exact-head Full Verify Green plus explicit approval for the two additive functions.
The future cleanup is an explicit staff action; no one-off 01756 update is included.
Rollback frontend; unused additive functions may remain until separately reviewed removal.

## Next action
Complete isolated verification and prepare PR for review. Do not alter user station
assignments or bypass existing ordinary KDS station guards to conceal this failure.

## Mandatory update protocol
Check main/PR head before writes. Unexpected movement => STOP_AND_RECONCILE.
Keep CURRENT_WORK_PLAN linked here. Record exact-head evidence in PR metadata
without changing tested files; metadata supersedes historical BLOCKED state.
