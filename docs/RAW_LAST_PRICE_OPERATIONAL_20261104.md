# Operational last-price cutover
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `feat/raw-last-price-operational-20261104`
Current PR: #602
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
The unused v2 issue rejected a missing price rather than recording0. Its
coordinate adapter omitted shortage details on an insufficient-stock failure.
Both candidate contracts are corrected. Additional reproduction found that
statement-clock ledger dates escaped the existing purchase-edit transaction-date
correction, and per-lot currency rounding doubled a one-cent raw movement.
These candidate defects are fixed and covered by regressions. Old receipts
still replay historical costs outside activated coordinates.

## Change ledger
Candidate writers now use the existing approved-price projection, including0
and known undated current prices. Frozen void/refund cost is retained. A bounded
owner-only converter preserves net quantity, original source money, journals and
settled quantity while marking legacy obligations as archived. Future counts
ignore archived debts and account for the aggregate shortage. Negative counts
on active coordinates create no new FIFO debt. Branch-default fixture coverage
includes newly created fallback raws. Routing/history guards prevent deleting
an activation marker, settling/deleting archived debt or repricing its source.
Ordinary ledger INSERTs do not pay for the exceptional repricing lookup.
Candidate movement money is allocated cumulatively across physical lots;
the existing per-lot rounding constraint retains all predicates, with its bound
changed from half a cent to one cent. The movement sum stays exact to cents.

## Verification ledger
The prior52 focused checks across7 files passed in6.1 seconds. The expanded
nine-file suite passed67 checks in8.33 seconds before the final history guards.
Includes old/new real POS sale/refund approval/shift lifecycle, direct reusable-group
raw deduction without any production/batch creation, frozen snapshot void/refund
after recipe/price change, destination-branch transfer price and retry/branch
checks, zero default, aggregate shortages and existing count regressions.
Application and test typecheck pass. General activation remains blocked.

The purchase-correction regression failed on the new writer and passed after
restoring transaction-clock movement timestamps (24 combined checks,3.46s).
The two-lot rounding regression reproduced -0.02 against -0.01 expected; the
corrected allocation also covers a three-lot residual exceeding half a cent.
Seventeen focused checks passed after the rounding-constraint adjustment.
Final history-guard run:68 checks across9 files passed in11.95 seconds,
including refusal to remove activation, settle/delete archived debts or reprice
their original ledger. Typecheck (application and tests), changed-file ESLint,
four active-worklog contract checks and git diff whitespace checks pass.
All fixtures use owned localhost transactions and roll back; no live business
orders, printer jobs or production stock changes were generated.

## Production gate
No activation until negative/zero/fractional issues, receipts, partial reversal,
purchase return, component groups, transfers, second count, retry, source provenance,
old-debt reconciliation and balanced financial journals all pass. An inactive
candidate is not completion or live deployment.

## Next action
Finish exact-head CI for #602, recheck live legacy snapshots, merge and apply the
single reviewed operational migration, then convert each negative coordinate in
bounded owner-authorized transactions. Finalize both branches only after no
unconverted negative positions remain; enable the new-branch default last.
No live writer routing has been changed yet.

## Coordinated release package
`20261104111802_raw_last_price_operational_cutover.sql` guards the exact24
modified pre-release functions, owners and ACLs. It preserves public adapters,
order-type/payment authority, the original send core and all print bindings.
One shared canonical resolver body now has an internal trusted-server mode;
report mode retains source RLS and invoice visibility. Browser roles cannot use
operational mode. No second price cache or price source is added.
The existing raw adapters remain INVOKER and retain their trusted service_role
contract through narrowly scoped private dependency grants; activation mutation
rights remain owner-only. Browser roles gain no helper/table access.
Kitchen capture reuses this event's indexed ledger records, including zero;
the normal group path never creates production or manufactured batches.
Quantity is normalized once to the existing four-decimal physical/ledger/count
precision and the actual quantity is passed into component snapshots.
Activated compatibility valuation uses quantity times the same last price.
Old administrative FIFO replay tools fail before writes after cutover starts.
Future raw coordinates inherit the branch default. Future branch defaults are
installed disabled until the final all-branch switch.

## Recovery
`scripts/rollback/raw_last_price_operational_pre_activation_20261104.sql`
restores the exact modified writer definitions and their ACLs only while the
activation table is empty. It never changes unrelated adapter overloads.
`scripts/recovery/raw_last_price_operational_20261104.sql` restores verified
last-price writers after activation, preserving quantities, original source
costs, journals and conversion history. Reverting converted positions to legacy
FIFO is deliberately blocked. Both paths are rehearsed in owned rollback tests.

## Verification update — fresh database
The earlier portable test database lacked three current API migrations and used
Cairo session time and taxed seed defaults. Its26 failures included one actual
new-writer defect: service_role could not read the private routing dependency.
That dependency contract is fixed and covered by active backend issue/receipt
checks. A new owned database was bootstrapped from the complete current canonical
migration chain with UTC, matching CI. Untaxed discount fixtures now explicitly
set their intended tax setting within their rollback transactions; no production
discount/tax behavior is changed.
The unpublished October load experiment executes768 dispatches and exceeded
three minutes. Its behavioral/security cases remain mandatory; only that load
benchmark now requires the explicit `legacy_dispatch_benchmark` workflow input.
The current full fresh-database result and exact-head CI are recorded below when
finished. No production business test rows or printer jobs are generated.

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

Fresh canonical suite:1220 checks passed; the remaining9 failures were the two
untaxed fixture groups now corrected. Rerun of those groups plus operational
price/cutover/recovery, service backend, normal groups and POS:44/44 pass across
8 files in16.4s. Typecheck, changed-file ESLint, API contract generation check,
4 active-worklog checks and whitespace verification pass. Exact-head CI must
still pass before merge/application.

Transfer quotes/approval now use the same closed operational price projection,
so restricted purchase-history access cannot change the receiver price. Existing
financial-context readers retain their prior visibility. An actual restricted
operator purchase-source test covers both quote and approval; historical transfer
rollback is rehearsed on its exact older reader call without weakening guards.
