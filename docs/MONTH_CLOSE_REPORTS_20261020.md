# Monthly reports and quick orders
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `feature/reports-month-close-quick-orders-20261020`
Current PR: `0`
Last updated: 2026-10-20
State: **BLOCKED**

## Work status
Owner approved implementation of reviewed reporting plan. Production release not yet requested.
## Guardrails
One writer. Development only. Preserve print agents, queue RPCs, kitchen/stock/accounting writers and all historical data. No production SQL changes or physical jobs.
## Baseline
Main `6d9cf06bbd2572a525e2b4419bdf971437265c1b`; previous scratch changes isolated in original worktree.
## Root-cause ledger
Consumption views currently mix stored cost and latest approved price; approved price may be purchase, count or pricing. Quick takeaway shares general create permission in both UI and SQL guards. Reports use overlapping navigation views.
## Change ledger
Implemented purchase-only consumption RPC (SECURITY INVOKER, existing RLS, server paging/full totals), net refund/void movements, explicit missing prices and unassigned product rows. New quick-create capability applies only to own open takeaway orders with no table; nested initial item-total recalculation is narrowly allowed. Seven wide primary workspaces, full-screen control and month checklist preserve existing report routes. Fixed hasUnsentItems memo dependency on authoritative/session send rows. No automatic permission grants.
## Verification ledger
Focused UI/permissions/navigation: 42 passed in 1.91s. App/test typecheck passed. Build passed in 14.30s. Full app suite: 1822 passed, 2 brittle source-order assertions failed; both corrected to the intended permission/navigation contracts, 11/11 focused rerun passed in 0.98s. Embedded PostgreSQL proof passed purchase-only pricing, net refunds, quick-only creation with nested totals, type/null denial and report permission denial; full canonical RLS/operational DB suite remains a CI gate. Lint passed. No arbitrary sleeps or weakened assertions.
## Production gate
No Merge ولا Production migration before separate owner release approval and exact-head required checks. No changes to installed Windows agent.
## Next action
Open draft PR, run required full CI once on the candidate. Review integration results and prepare exact rollback before requesting production release.
## Mandatory update protocol
Update this ledger with every implementation/verification outcome. Record actual skipped/failed checks. Never claim physical print confirmation from queue status.
