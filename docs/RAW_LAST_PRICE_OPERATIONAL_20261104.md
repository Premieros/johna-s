# Operational last-price cutover
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/raw-last-price-partial-cutover-20261104`
Current PR: #0
Last updated: 2026-11-04
State: **BLOCKED**

## Work status
#602 is merged, applied and published. Smouha is fully on the new raw path;
185 stock coordinates have been converted with quantity and source-cost proofs.
Finish the single remaining Cleopatra partial source through the verified
converter-only admission patch. Owner authorization includes merge/application.

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
Finish exact-head CI for the converter-only partial patch, merge/apply it,
convert the remaining Cleopatra coordinate with source-cost and quantity checks,
finalize Cleopatra, and enable automatic new-branch defaults only after both
branches have no unconverted legacy positions. Preserve the live Smouha path.

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

## Production update — #602 and final partial admission
#602 merged asb6af68c111ccd5361f3a7f25464a4ab06d78fabf. Exact PR CI41824803650,
post-merge Verify41825590321 and Pages41826469641 all succeeded. Production
migration20261104142855 `raw_last_price_operational_cutover` applied successfully.
185 coordinates converted in small transactions, preserving net quantities and
source-ledger money hashes;1666 legacy debt rows archived without changing their
settled quantity. Smouha branch default is enabled. Send-core fingerprint remains
09abdc1c2c47a48cc61d1dc3a310fe13. No synthetic live orders/printer jobs were created.

One Cleopatra material has a partial legacy source: debt0.04, settled0.01,
source unit12.06, source total-0.48. Its applied settlement records exactly0.4824
at48.24 per unit. The remaining recognized monetary basis is0, not the weighted
source unit cost times0.03. New admission requires exact source/debt quantity,
all settlement statuses applied, matching settled quantity, matching rounded
recorded money and matching weighted source price. Pending or mismatched evidence
is rejected. Other unsupported partial cases remain blocked.

The patch changes only the owner-only converter. It never rewrites the original
ledger, settlement history, journals or runtime raw writers. Tests reproduce the
actual numeric shape, preserve every historical row, prove future receipts post
only current variance, and rehearse strict-converter rollback/reapply. Cleopatra
branch default and automatic future-branch defaults remain pending this patch.

Partial patch verification:53/53 focused checks across5 files pass in2.57s;
includes invalid-evidence rejection and strict-converter rollback/reapply.
Application/test typechecks, changed-file lint and whitespace checks pass.
