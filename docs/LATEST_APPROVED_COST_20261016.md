# Latest approved raw prices — active work log
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `feature/latest-approved-cost-20261016`
Current PR: `#513`
Last updated: 2026-10-16 Cairo

## Work status
State: **BLOCKED**
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
Pending exact-head localhost regression, branches/financial RLS, source lifecycle,
normalization, as-of snapshot parity, indexed work, writes, concurrency and rollback.
Application/test typechecks and 22 targeted reader tests pass. First CI exposed a fixture status typo and a missing rollback statement separator; both corrected before any production change. Expanded exact-head verification is pending.

## Production gate
Blocked until exact-head Full Verify and scoped behavioral tests pass. Owner approval
covers migration/merge/deploy after evidence. Guarded rollback restores both exact original
resolvers, removes only exact cutover starting-price records, and removes the new
private projection and maintenance triggers. Genuine later user price changes and
all operational cost snapshots remain.

## Next action
Run complete CI, resolve demonstrated failures, rehearse rollback, then apply/verify both
branches and publish exact verified source. Observe natural traffic with bounded reads.

## Mandatory update protocol
Reconcile expected GitHub main and production definitions before writes. Freeze tested head.
Record test evidence, price differences due to the approved policy, rollout and rollback.
