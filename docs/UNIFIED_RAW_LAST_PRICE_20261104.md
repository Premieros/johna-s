# Unified raw prices and stock reads — 2026-11-04

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `refactor/unified-last-price-20261104`
Current PR: #601
Last updated: 2026-11-04
State: **DEPLOYED**

## Work status
Read-only source consolidation and the measured raw-stock authorization bottleneck
are fixed in production. PR601 merged as4e04e114fd2784d605a5e0d0c70bcea0eb5d42f9.
Exact-head PR Verify41809525503 and post-merge Verify41810270484 passed all four
jobs. Production migration20261104095037 (`unified_raw_stock_last_price_reads`)
is applied; canonical source is
`supabase/migrations/20261104091453_unified_raw_stock_last_price_reads.sql`.
Pages release41810949930 is verified separately below.

This release does NOT retire operational FIFO writers. November counts00008/00009
remain applied and must never be posted again.

## Guardrails
No business rows, quantity batches, price events, FIFO debts, sales, kitchen sends,
printers, journals or count documents are mutated by this release. No new table,
index, polling, background queue, privileged public reader or paid upgrade.
Stock/price failures remain errors; inaccessible materials are not fabricated.
The SELECT policy uses the existing branch authorization function; grants and
other policies are unchanged. Guarded rollback restores the original predicate
and current-price function, without reversing customer stock or journals.

## Baseline
Main9e0d096 before this work. Both branches' legacy summary quantities already
matched canonical batch sums across809 materials. Consolidation prevents a second
future balance source; it does not claim those current balances were incorrect.

Authenticated Smouha aggregation took2909.694ms for292 grouped materials over17268
physical batch rows, using an index, zero disk reads and26323 shared-buffer hits.
The plan executed nested branch authorization per batch. An initial all-branch
read exceeded its3-second safety deadline and was cancelled; the deadline was not
raised. Cumulative statement counters reset2026-09-01 and are not today's latency.

## Root-cause ledger
- Per-batch `user_may_access_branch(branch_id)` caused avoidable CPU work.
- Material/reorder screens read a separate `raw_material_inventory` projection.
- Count preview fetched unpaged lot history and could silently lose rows.
- Stock screen displayed a FIFO unit cost beside published last price.
- Current-price RPC returned NULL and its client rejected a valid numeric zero.

## Change ledger
- Raw-batch SELECT policy resolves allowed branch IDs once/query, then checks
  membership using the same authorization function. Mandatory non-NULL branch
  and the exact old policy hash are checked before replacement.
- Bounded INVOKER `get_raw_material_stock_summary` pages500 material identities
  before canonical quantity aggregation and indexed published-price lookup.
- Material stock and reorder reuse this projection. Stock tab reuses returned
  prices instead of making another price read.
- Count preview pages aggregate warehouse balances, retaining all signed lots.
- Current public price projects absent visible source price as0/catalog_zero.
  The underlying historical resolver, source precedence and visibility remain.
- Current stock value is signed quantity multiplied by this same last price.
  Original purchase documents and historical financial snapshots are unchanged.

## Verification ledger
54 focused DB checks across7 files,25 costing/source checks,109 additional
branch/security checks and focused client checks passed in owned local PostgreSQL.
No production test rows. Tests include fractional/negative lots, stale legacy
summary, zero default, complete pages, branch denial, additionally granted branch,
report amounts/refunds, invalid recipes, old/new guarded rollback and unchanged
writer definitions. A32-lot differential test measured fewer authorization calls
with exactly identical RLS-visible rows. All mandatory CI jobs then passed.

Production same-query Smouha EXPLAIN:2909.694→421.001ms (~85.5% reduction; ~6.9x),
292 output materials retained, shared-buffer hits26323→1069. This is a measured
query improvement, not a peak-load/global latency guarantee.

Same-transaction authenticated reconciliation:
| Branch | Materials | Quantity mismatches | Price mismatches |
|---|---:|---:|---:|
| Smouha |407|0|0|
| Cleopatra |402|0|0|

All known positive price/source/date/reference fingerprints remained unchanged.
A cross-time Smouha quantity fingerprint changed during live operation; it is not
used as a before/after equality claim. The in-transaction comparisons above both
match exactly. Core sale/kitchen/print/count/receipt writer fingerprint remained
cc44b8dc075e0b5487149783680796c0. Security advisor finding names/counts unchanged:
26 rls_enabled_no_policy,254 authenticated_security_definer_function_executable,
1 auth_leaked_password_protection. These are preexisting, not resolved here.

## Production gate
Read-only release passed source, security, exact-head CI, guarded migration and
live reconciliation gates. Rollback:
`scripts/rollback/unified_raw_stock_last_price_reads_20261104.sql`.
Do not reapply this migration or either November count. Global writer activation
still requires the operational gates below.

## Next action
Complete ONE coordinated operational last-price release, rather than enabling
unverified individual writers:
1. Default-zero approved source snapshots in all raw issue paths. Existing
   non-count v2 prototype still rejects an absent positive source; that rule is
   superseded by the owner's zero-default policy.
2. Full caller-result parity. In particular,
   `_produce_inventory_unit_internal` checks shortage but not success; a routed
   failure must not create manufactured stock at zero consumption.
3. Snapshot-based kitchen void, sale refund, production reverse, purchase return
   and transfer reversal; receipt/variance journals must reverse exactly once.
4. Reconcile and convert legacy positions in bounded, audited transactions,
   preserving original sources/journals. At the read-only2026-11-04 audit there
   were774 open rows/88 positions in Smouha and915/94 in Cleopatra, with zero open
   rows predating November. This does not mean all FIFO obligations are retired.
5. Raw-only future counts must handle aggregate shortage positions correctly;
   mixed/product counts and full writer permissions need explicit compatibility.
6. Verify same/cross-branch transfer, manufacture/component use, sale/void/refund,
   second count, zero/fractional prices, concurrency, retries and balanced journals
   in small deterministic owned fixtures. Do not activate or invent accounting
   corrections until these gates pass.

One current quantity source remains the signed batch sum, via existing
`private.raw_stock_quantities`. Current price remains the existing indexed
approved-price source; no new independent valuation engine or price table.
Physical expiry/lot traceability is distinct from financial FIFO replay.

## Mandatory update protocol
Record actual CI, merge, migration, Pages and reconciliation results. Never equate
a candidate or read-only release with global operational FIFO retirement.

## Final Pages verification
GitHub Pages41810949930 completed successfully: build, production API parity and
deployment all green for merge4e04e114. The new stock/price UI is published.
