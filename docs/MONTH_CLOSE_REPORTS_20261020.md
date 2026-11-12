# Monthly reports and quick orders
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `feature/reports-month-close-quick-orders-20261020`
Current PR: `524`
Last updated: 2026-10-20
State: **BLOCKED**

## Owner correction — 2026-10-20 09:56 Cairo
Missing prices must be numeric zero in rows, totals and exports. Use the canonical latest approved raw price from purchase, pricing or applied stock count; show source/date. This supersedes earlier purchase-only and null-price descriptions below. No production release approval has been given.

## Work status
Owner approved implementation of reviewed reporting plan. Production release not yet requested.
## Guardrails
One writer. Development only. Preserve print agents, queue RPCs, kitchen/stock/accounting writers and all historical data. No production SQL changes or physical jobs.
## Baseline
Main `6d9cf06bbd2572a525e2b4419bdf971437265c1b`; previous scratch changes isolated in original worktree.
## Root-cause ledger
Consumption views currently mix stored cost and latest approved price; approved price may be purchase, count or pricing. Quick takeaway shares general create permission in both UI and SQL guards. Reports use overlapping navigation views.
## Change ledger
Implemented purchase-only consumption RPC (SECURITY INVOKER, existing RLS, server paging/full totals), net refund/void movements, explicit missing prices and unassigned product rows. New quick-create capability applies only to own open takeaway orders with no table; nested initial item-total recalculation is narrowly allowed. Seven wide primary workspaces, full-screen control and month checklist preserve existing report routes. Fixed hasUnsentItems memo dependency on authoritative/session send rows. No automatic permission grants. The quick-only creation path rejects order/line discounts and bonus quantities unless pos.discount is granted. Month review has a manual aggregate summary (sales, invoice collection, purchases, posted expenses, authorized consumption); failed/null sources remain unavailable. Consumption totals round only once after aggregation, so product grouping preserves totals.
## Verification ledger
Focused UI/permissions/navigation: 42 passed in 1.91s. App/test typecheck passed. Build passed in 14.30s. Full app suite: 1822 passed, 2 brittle source-order assertions failed; both corrected to the intended permission/navigation contracts, 11/11 focused rerun passed in 0.98s. Embedded PostgreSQL proof passed purchase-only pricing, net refunds, quick-only creation with nested totals, type/null denial and report permission denial; first full CI canonical DB run: 1097 existing tests passed, new fixture setup failed on ambiguous numeric parameter inference (integer vs numeric), corrected with an explicit numeric cast. Second CI run: 1102 DB tests passed, including quick-only creation/denial and consumption/RLS behavior; one new fractional fixture violated the existing raw-or-product XOR constraint. Corrected it to use the genuine kitchen event link instead of filling both ledger item IDs. App verification, browser smoke and Pages continuity all passed on 1477df30. Final exact-head checks pending. Lint passed. Additional month-summary/navigation tests: 10 passed in 1.64s; export/CI-dedup tests: 7 passed in 1.66s. Final local build passed in 8.54s. Canonical rollback rehearsal restored exact original function body hashes. No arbitrary sleeps or weakened assertions. Fast Verify now avoids duplicate app/DB jobs only when an open main/master PR points to the identical pushed head; manual runs and API failure retain fast checks. Full Verify remains mandatory.
## Production gate
No Merge ولا Production migration before separate owner release approval and exact-head required checks. Apply the read RPC/authorization migration before the new frontend; production parity must pass. Restore the baseline frontend before the reviewed SQL rollback, which fails closed on mismatched bodies. No changes to installed Windows agent.
## Next action
Draft PR #524 is open. Initial full CI exercised existing 1097 DB cases successfully; fix new fixture cast, verify remaining new cases, and rerun on final candidate. Rollback was rehearsed in embedded PostgreSQL and restored exact original function body hashes; no production change.
## Mandatory update protocol
Update this ledger with every implementation/verification outcome. Record actual skipped/failed checks. Never claim physical print confirmation from queue status.

### Compact spreadsheet report layout (owner request, 20 October)

- Collapsed report discovery and date/filter controls preserve available options without extra reads. The active report title, view picker, Run and export controls remain accessible.
- Scoped report grid styling adds dense bordered cells, alternating rows, two-axis scrolling, a sticky column header and a frozen visible primary identifier; RTL uses logical inline positioning. Operational/consumption identifiers follow the description even after column ordering. Financial tables retain their existing accounting arithmetic.
- Full report totals/counts remain visible in a sticky footer for operational and consumption tables, taken from their existing complete-result summaries, never a visible-page sum. Unit prices are not summed. Analysis totals use only additive column contracts and filtered full data; unknown amounts remain unavailable.
- Existing mobile report cards are retained. Fullscreen expands the report viewport; report styling does not affect POS tables or print-agent behavior. No database migration, RLS, stock, accounting or printing changes were added for this layout request.
- Focused UI/analysis/source/primary-column checks passed 41/41 in 6.26s; app/test typechecking, ESLint (zero errors, two pre-existing financial hook warnings) and production build passed. Exact-head CI status is recorded in PR #524. Browser regression now additionally checks frozen identifiers, complete-result footer and vertical header stability in the existing pagination case (no new long-running browser scenario).

### Read-load review (owner request, 20 October)

- Production inspection was metadata-only: confirmed `idx_inventory_ledger_branch_created_at(branch_id, created_at DESC)` and the canonical `raw_approved_price_latest` index. No heavy production report, EXPLAIN ANALYZE, DDL or business mutation was executed.
- Consumption stays manual, with 100-row screen pages. Latest prices are read once for distinct consumed material IDs, never from FIFO layers. Product-event joins are gated to product grouping. Accessible branch IDs are resolved once in an uncorrelated array subquery, rather than repeating the explicit branch-access function per movement; existing source RLS remains intact.
- Registered the new read-only RPC with the existing one-minute request sharing cache. Auth/header/branch/date/filter/page identities stay separate; writes and permission changes invalidate reuse. This also prevents consumption reads from being treated as mutations that flush other report snapshots.
- Export previously recalculated the full aggregation once per 500-row batch. It now requests a single explicitly initiated bounded result (at most 5000 rows), validates the full count/summary and refuses partial/changed or oversized exports. No full-dataset request occurs on page opening, filter editing or ordinary 100-row viewing.
- Targeted tests passed 41/41 in 5.31s, including sharing/isolation, 1001-row single-request export, rejection above 5000 rows and unchanged complete totals. App/test typecheck, ESLint, build and API contract checks passed. Added canonical DB assertions for 5000/5001 and all-accessible-branch results; exact-head CI remains the release gate.
- Synthetic embedded PostgreSQL exercise used the actual new report and canonical price-reader SQL, 100000 out-of-period movements and 3003 in-period movements, with a matching date index. Five report runs took 11–16ms with correct totals; the date probe selected an index plan. Authorization was stubbed in this isolated harness: these timings are not production measurements or a production performance guarantee. Permission behavior remains covered by canonical DB CI. Exact original create/guard function hashes were recovered after rollback rehearsal.
- Prior layout commit d84fe1a passed browser/DB/continuity gates; two source-text UI assertions failed on harmless additional table attributes and changed scrolling utility spelling. They now assert the same table/mobile layout contract without depending on exact historic opening tags. No behavioral assertion or mandatory workflow gate was removed.

### Consolidated final report clarity batch (owner request, 20 October)

All work stays in draft PR #524 for one release: seven essential report workspaces, consumption at canonical latest purchase/initial/manual/count price with numeric zero when missing, independent quick-order permission, compact spreadsheet layout, scoped bounded read sharing/export and the following clarity corrections.

- Financial-material and theoretical/actual reconciliation branch summaries are separate snapshot metadata, not data rows. Screen analysis, grouping, CSV and Excel detail data therefore cannot sum a period total together with its constituents. The summary is rendered separately, exported in Excel's Summary sheet and printed as a separate escaped definition list.
- Metric labels match the existing authoritative amount across the filter strip, complete-result footer and Excel summary (net sales, net purchases, posted expenses, revenue excluding tax, recorded inventory/consumption or theoretical consumption). Mixed-unit inventory quantities, catalog prices and recipe prices have no misleading currency grand total.
- Payment-method allocation explicitly distinguishes credit allocation from received cash. Recorded movement/operation cost is visibly distinguished from current-price revaluation without rewriting accounting or historical costs.
- Result context uses the applied period, scoped branch and client receipt time. Editing draft filters cannot relabel the old result. Receipt time is not presented as the source's update timestamp; the consumption report shows its actual SQL `generated_at`. Existing one-minute reuse/explicit refresh behavior remains documented in the UI.
- No queries or writes were added: summaries use the existing response; no materialized balance/price writes, stock recalculation, RLS changes or printer-agent changes. Malformed material-summary/reconciliation response structures fail explicitly rather than publishing an empty result.
- Focused validation: 53/53 tests in 6.42s, including summary/detail isolation in both report families and exports, no new source read on export, applied-period stability after editing, and escaped printed summaries. App/test typecheck, ESLint and build (8.80s) passed. The preceding full head dd7bce7 passed app, database, browser and continuity gates. Final exact-head verification is recorded in the PR body. Production is not changed; the prepared migration still must precede the frontend at release.
