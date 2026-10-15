# Latest approved raw prices — active work log
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `feature/latest-approved-cost-20261016`
Current PR: `#513`
Last updated: 2026-10-16 Cairo

## Work status
State: **DATABASE APPLIED; FRONTEND RELEASE PENDING**
Owner approved implementation and rollout at 00:53 Cairo. Exact-head verification gates production.

## Guardrails
One sequential writer. Only this repository and database. Both Smouha and Cleopatra.
No FIFO stock/debt/accounting writers, old costs, monetary totals, frozen print RPCs,
KDS permissions or Windows software changes. No live operational fixtures or replay.
No broad log scans. No existing RLS, grants or constraints removed.

## Baseline
Main91801e73, #512 active. Existing two resolver definition hashes pinned in migration.

## Root-cause ledger
Display helper overrides approved prices with inventory FIFO averages. Current resolver
collects historical sources at read time. New policy uses approved prices exclusively;
unpriced stays NULL. Existing stock/accounting valuation is a separate immutable contract.

## Change ledger
Compact private price projection contains only purchase prices, count prices and manual
pricing events, never FIFO issue/batch history. Indexed latest-row reads serve displays,
recipes, current costing and exact as-of kitchen snapshots through shared invoker resolver.
Source INSERT/UPDATE/DELETE and parent metadata changes synchronize in the same transaction;
parent status/financial/source visibility is checked at read time. Legacy receipt prices
are suppressed by any canonical purchase ledger and normalized with the existing helper.
Keep dated price entries rather than one mutable latest row: different roles can legitimately
see different financial sources and past dispatch times must not take future prices.
Three private trigger-only maintenance definers have no app/service/public EXECUTE, fixed
search_path and no input arguments; they mirror only attached source rows. They never
expose a privileged read API. The projection has SELECT-only RLS; explicit purchase
financial checks also remain in nested existing definers. No new role capability.
Existing positive last-batch/inventory/catalog fallback prices are preserved ONCE
as owner-approved starting manual prices, dated at cutover to avoid retrospectively
pricing old kitchen dispatches. Unknown/zero stays unpriced. Actual positive catalog
price edits/imports create dated manual price records; existing explicit pricing RPC
is deduplicated. No names-only/no-op/received-quantity/return-amount cache writes.
Catalog writes are briefly locked with a two-second lock budget during cutover.
The old current-price map is read once and reused for starting prices; an exact
numeric comparison of EVERY material runs before COMMIT. Any missing/changed price
aborts the whole migration. No repeated preflight history scan is necessary.
Price-source tables and actual positive manual catalog price changes receive new triggers. Ledger WHEN excludes all FIFO issue,
oversold and reconciliation writes. Purchase/count business functions remain byte-identical.

## Verification ledger
Exact source f73a92ce12a2e5ace77553aab88ece991ee99734 passed Full Verify 38817268988:
1081 database tests in 193 files, 1793 application tests in 369 files, 132 Chromium
checks, typechecks, lint, build and Pages continuity. Source lifecycle/RLS, exact
as-of prices, normalization, concurrency and guarded rollback were exercised.
Synthetic price lookup: 15051 to 37 buffer reads, 53.444ms to 0.925ms; this is a
controlled fixture, not a production peak latency guarantee. Actual FIFO issue WAL
median changed about 1% in the fixture, within its 5% tolerance.

## Production application
Owner approval at 00:53 Cairo covers migration, merge and deployment after verification.
Applied at 2026-10-16 01:34 Cairo as 20261015223414_latest_approved_price_read_model.
SQL SHA256: 083e7a374b8fa23b8e4b48237c5f337ec5f5f9917d18be5776506ffda830b0af.
The transaction compared numeric current prices for EVERY material and committed
only after exact parity. Both changed readers are invokers with expected hashes.
Postapply 01:37 Cairo: all other function/ACL/owner, existing policy, trigger and
existing table security fingerprints match preapply exactly. No new print jobs
were present in this short observation window; this does not prove peak stability.
The source migration filename is reconciled to the server-assigned version without
changing or reapplying SQL. Frontend publication remains pending.

## Recovery and next action
Guarded rollback restores both exact original resolvers and removes only exact
cutover starting-price records plus the new private projection and triggers.
Genuine later user price changes and every operational snapshot remain.
Verify reconciled source, merge and publish the frontend, then inspect bounded
natural-traffic evidence. Display policy now selects the last approved price rather
than a FIFO average; historical saved costs and actual inventory accounting remain.

## Mandatory update protocol
Reconcile expected GitHub main and production definitions before writes. Freeze tested head.
Record test evidence, price differences due to the approved policy, rollout and rollback.
