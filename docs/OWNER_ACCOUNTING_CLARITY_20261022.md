# Owner accounting clarity
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/owner-accounting-clarity-20261022`
Current PR: `532`
Last updated: 2026-10-22

## Work status
State: **BLOCKED**
Owner authorized preparing repairs following the accounting review. Production release remains separate.

## Guardrails
No production DDL or business writes during preparation. Preserve sales, printing, installed Windows agents, KDS, stock/cost writers, RLS and function ACLs/security. No new tables, triggers, indexes, polling, automatic read retry or report RPC calls. Keep the Windows experiment isolated.

## Baseline
Main 6b7688e2e1ac669c3fc5f5c9de4bfbdb19a279ce (#531 released). Captured current income-statement and balance-sheet definitions and exact source hashes with two bounded read-only metadata queries. No customer balances were audited in this work.

## Root-cause ledger
- Month summary dropped missing-recipe/unit diagnostics from its existing consumption response.
- Income statement included only mapped revenue/other-income accounts; balance-sheet profit included all income. Other income also inflated gross sales profit.
- Balance sheet excluded inactive accounts, erasing their posted historical balances from that report.
- Treasury running journal balances were named actual cash/bank balances.
- Aging summary combined receivables and payables and had four headings for five cells.
- Selector services ignored read errors and presented inaccessible data as empty.

## Change ledger
- Retain consumption diagnostics and show a partial-cost warning. Calculate owner estimated margin and result after posted expenses locally from existing aggregates, only with complete prices/recipes/units and unrestricted history. Missing prices still count as zero in consumption; no invented cost or change to the canonical pricing policy.
- Explain estimated current-recipe valuation versus posted accounting profit, and review versus a locked month.
- Guarded replacements of two read-only report functions. Income retains the same materialized history bounds and journal aggregation. Mapped sales/discount/COGS form sales margin; all other income appears separately, including custom income accounts. Net income uses all income minus all expenses. Balance sheet retains inactive-account history. No change to operational accounting entries.
- Existing net_revenue/gross_profit semantics intentionally change to exclude other income. Optional other_income JSON field supports old/new frontend rollout. Table and Excel show the new row when supplied.
- Income is period-based; balance sheet is cumulative as of date. Compare period income with the change in cumulative profit over matching dates, not with a different-period total.
- Rename treasury balances to book balances. Keep AR/AP separate and repair aging headers.
- Surface selector errors with manual retry and retain stale-context cancellation/run blocking.

## Verification ledger
42 focused tests passed in 2.23 seconds. Application and test typechecks passed. Isolated disposable Postgres proof reproduces original omitted custom income and inflated margin, checks exact repaired totals, inactive-account history and period/cumulative agreement, branch/date/history/RLS isolation, unchanged ACL/invoker/search_path, source drift rejection, and exact guarded rollback. Database identity and API contract checks passed. Build passed in 9.18 seconds; lint passed with zero errors and 12 existing warnings. Full CI pending final head. No test writes to production.

## Production gate
State: **BLOCKED**
No Merge ولا Production migration before separate owner approval after final verification. Apply guarded migration before deploying new UI for a single coherent release. SQL rollback restores only these two report definitions; no data rollback. Exact source drift aborts the transaction.

## Next action
Finish exact-head checks and present the PR for release review. Actual month approval/locking/reopening is a distinct workflow requiring explicit period policy and enforcement across writers; this repair does not introduce it or claim a locked close. Owner summary is operational and excludes other adjustments; it is not a certified accounting net profit or bank/cash count.

## Mandatory update protocol
Reconcile main and PR head before merge. Record actual CI and apply results, verify function source hashes/ACLs before and after any approved migration, and update release status only after successful deployment. Do not auto-retry financial writes.
