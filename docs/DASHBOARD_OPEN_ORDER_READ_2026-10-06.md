# DASHBOARD OPEN ORDER READ — ACTIVE WORK LOG
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/dashboard-open-order-read-20261006`
Current PR: `#0`
Last updated: 2026-10-06
Execution mode: **SINGLE_WRITER**
Parallel execution: **FORBIDDEN**
Unexpected HEAD policy: **STOP_AND_RECONCILE**
Write mode: **SEQUENTIAL_ONLY**

## Work status
State: **BLOCKED**
User requested repair of visible dashboard error before marketing capture.

## Guardrails
Frontend only. No DB apply, RLS, permissions, history, FIFO, balances, sales writes,
KDS, printing, shifts or automations changes. No live sales/send/printing tests.
No polling or automatic retries added. No force push or direct main writes.

## Baseline
Main a6e838ae477fcd1c1e55812bcc5cc3c7b7063d7e, merged #463 confirmed.
Separate clean worktree. Older dirty worktrees retained untouched.

## Root-cause ledger
Cloud browser dashboard open-order value unavailable; other metrics available.
Production edge logs at 2026-10-06T18:27:49.107Z confirm dashboard orders GET
with order_items(quantity) returns HTTP 300. Existing POS explicit constraint embed
returns HTTP 200. Read-only pg_constraint confirms order_items_order_id_fkey.
PostgREST documented !foreign_key disambiguation resolves HTTP 300 ambiguity.
No assertion of timeout, RLS denial or missing orders. No financial data in log.

## Change ledger
Name the existing FK in dashboard nested order_items selection. Retain existing
field list, branch/status filters, limit, quantity-based empty-order exclusion,
independent error indicators and manual refresh. Same single request count.

## Verification ledger
Targeted service/component and mandatory-log tests; typecheck:all, changed-file
lint, build and contract check. Exact-head Full Verify required before publication.
Live dashboard verification follows approved publication; not yet completed.

## Production gate
State: **BLOCKED**
No DB change. Merge only after exact-head Full Verify green and explicit approval
of this repair. Roll back frontend normally; operational data remains unchanged.

## Next action
Validate, create PR, run Full Verify and present concrete publication approval.

## Mandatory update protocol
Check expected main/branch heads before sequential writes. Stop/reconcile drift.
Freeze exact tested head after CI starts; record CI/approval in PR metadata.
