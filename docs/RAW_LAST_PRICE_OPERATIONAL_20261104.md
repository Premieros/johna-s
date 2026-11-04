# Operational last-price cutover
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `feat/raw-last-price-operational-20261104`
Current PR: #0
Last updated: 2026-11-04
State: **BLOCKED**

## Work status
Continue from deployed #601. Owner authorization includes verified merge and
application. Implement and verify the whole raw writer lifecycle before routing
live sales through it. No new production activation has occurred in this stage.

## Guardrails
Preserve deployed count00008/00009 and #601. Use the existing approved-price
source, with zero default, and signed batch quantity source. No synthetic writes
on production, no paid upgrade, no historical sale replay, no discarded debt or
journal records. Existing permissions and physical lot/expiry metadata remain.

## Baseline
Main da230d7. Private v2 issue/receipt helpers exist for raw counts but general
coordinate routing remains an unused candidate. Old raw sale/receipt writers are
still authoritative outside raw-only counts. Last read-only audit showed774/915
open legacy debt rows (Smouha/Cleopatra), all dated November.

## Root-cause ledger
The unused v2 issue still rejects a missing price rather than recording0. Its
coordinate adapter returns an insufficient-stock failure without a shortage,
and consumers must retain explicit failure/quantity semantics. The group path
already checks success. Old receipts also replay historical costs.

## Change ledger
In progress: unify candidate price projection, preserve zero and undated current
prices, restore exact result/error contracts, prove source-price refund/void,
then bounded legacy conversion and count/transfer/component-group compatibility.

## Verification ledger
52 focused checks across7 files pass in one owned-Postgres batch (6.1 seconds).
Includes old/new real POS sale/refund approval/shift lifecycle, direct reusable-group
raw deduction without any production/batch creation, frozen snapshot void/refund
after recipe/price change, destination-branch transfer price and retry/branch
checks, zero default, aggregate shortages and existing count regressions.
Application and test typecheck pass. General activation remains blocked.

## Production gate
No activation until negative/zero/fractional issues, receipts, partial reversal,
purchase return, component groups, transfers, second count, retry, source provenance,
old-debt reconciliation and balanced financial journals all pass. An inactive
candidate is not completion or live deployment.

## Next action
Finish bounded legacy-position conversion and future-count compatibility. Complete
one coordinated writer/reversal release, preserving the ordinary sale/print path.

## Mandatory update protocol
Record actual implementation, tests, PR, CI and production results. Preserve
earlier published work and never label the general FIFO replacement complete
while live writer bindings remain legacy.

## Owner clarification — component groups, not manufacturing
The user confirms the earlier manufacturing retirement: a reusable group is
expanded to raw components and deducted directly. Confirmed source:
`resolve_product_raw_components` / `_deduct_kitchen_raw_components`. Internal
`manufactured` enum/old function names do not authorize restoring production.
The normal send/sale path must create no `inventory_unit_productions` or
manufactured batches. Remove the newly proposed old-production caller change
from this bundle; it was never applied to production. Test the real group path,
including nested groups, last-price raw snapshots and exact-once void/refund.
