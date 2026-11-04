# Unified raw prices and stock reads — 2026-11-04

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `refactor/unified-last-price-20261104`
Current PR: #601
Last updated: 2026-11-04
State: **READY**

## Current scope
Owner requests continuing source consolidation, removing expensive reads and
replacing financial FIFO with published last price. Merge and application are
authorized after verification. November counts00008/00009 are already applied
and reconciled; never post them again.

## Source contract
- Current raw quantity: SUM of signed `raw_material_batches.quantity`, through
  existing `private.raw_stock_quantities`. The legacy summary table is a writer
  compatibility projection, not an independent current balance source.
- Current unit price: existing `private.latest_approved_raw_prices`, respecting
  branch/source visibility. `get_raw_material_current_prices` projects missing
  accessible source prices as numeric zero, with explicit `catalog_zero` metadata.
  Failed requests and inaccessible materials are never converted to zero rows.
- Current valuation: signed current quantity multiplied by this same unit price.
- Historical reversals must use original movement snapshots, not today's price.
- Physical expiry/batch tracking is distinct from financial FIFO repricing.

## Findings and order
1. Material stock and reorder screens still read `raw_material_inventory` while
   reports use summed batches. Count preview downloads unpaged batch history.
   Replace these reads with bounded aggregated stock, not another stock table.
2. Material stock screen still displays FIFO unit cost beside published price.
   Replace the obsolete column with current signed stock value at last price.
3. Public current-price RPC still emits NULL for a never-priced material; client
   helpers also reject explicit zero. Preserve zero and the error boundary.
4. Core `_raw_remove_fifo` and `_raw_add` still call legacy issue/settlement.
   Receipt settlement can rewrite historical sale/kitchen costs. Do not flip
   those bindings until reversal, journal and legacy-position gates below pass.

## Release boundaries
First release is read-only: no stock, journal, FIFO debt, sale, kitchen, print or
price-source business mutations. Preserve all applied count fixes. Use existing
RLS and INVOKER functions; no new privileged public reader. No polling, cache
table, background queue or infrastructure upgrade.

## Remaining operational cutover
Inventory of direct core callers includes kitchen send/void, sale/refund,
production/reversal, purchase/return, same-branch and cross-branch transfer,
manual adjustment and product/mixed counts. Each needs source-price freeze,
signed quantity parity, exact-once reversal, unchanged authorization and balanced
journals. Legacy obligations must be audited and converted in bounded transactions
without deleting original source records or replaying old sales during checkout.
The old prototype's positive-price-only rule is superseded by the owner's zero
default policy. Global FIFO retirement is not completed by a read-only release.

## Verification and rollout
Pending implementation, focused behavioral/DB tests, exact-head CI, guarded
migration, Pages deployment and live read-only parity verification. Record actual
results here as they happen. Keep a rollback restoring only reader bindings;
never reverse or reapply the two customer counts as rollback of this work.

## Work status
Read-only implementation complete;32 focused integration checks and23 additional
client checks pass. An earlier18-unit check passed. Typecheck and changed-file
lint pass. No production migration or Pages deployment yet.

## Guardrails
Preserve stock, source events, old debts, journals, sale/kitchen/print writers and
all applied count data. No new source table or polling. Page identities before
aggregate/price resolution. Missing access/errors must not fabricate zero rows.

## Baseline
Main9e0d096; both production branches have zero discrepancies between current
legacy summary quantities and canonical batch sums (809 materials). Consolidation
removes a future divergence source; this is not a claim that current stock is
incorrect. Stats reset2026-09-01; top cumulative statement timings are historical,
not measurements of today's bottleneck. Legacy exact POS availability no longer
has a frontend caller and must not be optimized based on accumulated rank alone.

## Root-cause ledger
Material/reorder reads still use a second quantity projection. Count snapshot
silently caps an unpaged lot-history read. Stock screen shows a FIFO cost beside
last price. Client numeric helper discards zero.

## Change ledger
Bounded INVOKER stock-summary RPC uses existing quantity view plus indexed price
resolver, one500-material page at a time. Material/reorder services use it;
stock tab reuses its returned price instead of a second RPC. Count preview pages
warehouse aggregates, retaining all lots' signed sum without downloading history.
Public current-price RPC returns default0; historical resolver/snapshots unchanged.
Stock screen replaces FIFO column with signed balance times last price. Guarded
reader-only rollback is rehearsed before the immutable October rollback proof.

## Verification ledger
32 DB checks across5 files pass in owned local PostgreSQL, including applied
count regressions, fractional quantities, negative lots, deliberately stale
summary, zero default, RLS branch denial, bounded pages and both reader rollbacks.
23 client checks pass across4 files plus18 checks across5 earlier focused files.
No production test rows. Exact-head full CI remains required.

## Production gate
Pending exact-head four-job CI and guarded read-only migration, then Pages after
verified main. Live parity must compare quantities and every known positive
price under the same authorized user in both branches. No global FIFO activation.

## Next action
Publish reviewed read-only PR, verify CI, apply exact migration once, merge and
verify Pages. Continue operational cutover separately with the listed gates.

## Mandatory update protocol
Record actual CI, migration, merge and live parity results here. Never equate
source merge with production activation or claim global FIFO retirement.

## Additional measured root cause — before production application
Authenticated Smouha stock aggregation under the existing RLS policy took2909.694ms
for292 grouped materials /17268 physical batch rows, all buffer hits and zero disk
reads. The indexed scan still called `user_may_access_branch(branch_id)` per row.
An all-branch parity probe exceeded its3-second safety deadline and was cancelled.
Do not raise that deadline or mistake cumulative query counters for this proof.

The guarded release also changes only the raw-batch SELECT policy expression:
resolve accessible branch IDs once using the exact same authorization function,
then use membership for every batch. Table/role grants, other policies and every
writer remain unchanged. Mandatory non-NULL branch FK and exact old policy hash
are checked before replacement. Rollback restores the exact original predicate.
A32-lot local differential test proves fewer actual authorization function calls,
identical home-branch rows and identical additionally granted-branch rows.

54 focused DB checks across7 files now pass, including report default-zero
semantics, existing price-source RLS and both old/new rollback rehearsals. A further
25 costing/source checks pass after replacing old NULL expectations with the
owner's numeric-zero contract. First full CI found only obsolete source-contract
and NULL/missing-price expectations; these are corrected without removing source,
branch, amount, refund, invalid-recipe or rollback assertions. A fresh exact-head
full run is required for the policy expression change. No production application
has occurred yet.
