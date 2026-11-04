# Operational last-price cutover
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/raw-last-price-partial-cutover-20261104`
Current PR: #603
Last updated: 2026-11-04
State: **DEPLOYED**

## Work status
The canonical last-price raw path is enabled in both production branches,
Smouha and Cleopatra. Automatic future-branch defaults are enabled. #602 and
#603 are merged, applied and published through verified GitHub Pages deployment.
No stock-conversion, activation or publication step remains.

186 stock coordinates and1825 legacy debt rows were converted with exact
net-quantity and source-money preservation. There are0 unconverted open debts
and0 legacy negative batches outside the aggregate path. The two original
stock counts remain applied and were not replayed.

## Guardrails
Use the existing approved-price source, including default0, and the signed-batch
quantity source. Keep original sales/count money, settlement quantities and
journals. Preserve branch isolation and existing browser financial visibility.
Reusable groups resolve and deduct raw components directly; do not recreate
manufacturing records or manufactured batches. Selling/printing authority and
station/order identities remain intact. No synthetic live orders or printer
jobs, paid upgrade, historical sales replay or old FIFO backfill was used.

## Baseline
Started frommainda230d7 and deployed #601. #601 had already unified bounded
current raw stock/price reads. General raw issue/receipt routing still used
legacy FIFO outside raw-only counts. The applied original counts are:
-00008 Smouha:8e04fe58-a5d6-4daa-a02d-8dee6245bed5
-00009 Cleopatra:4d14a222-5fbc-459a-b5b1-b11dba9cf975
Their November1 effective dates and November4 posting timestamps were retained.

## Root-cause ledger
The inactive prototype rejected default0, omitted shortage failure fields,
and used statement-clock dates that escaped purchase correction's original-date
matching. Independent rounding of physical lots could double a one-cent raw
movement. Trusted service adapters also needed explicit private dependency
rights. Transfer receiver prices depended on purchase-history browsing rights.
These defects are corrected and covered by regressions.

One legacy partial source needed a precise conversion rule: debt0.04, settled
quantity0.01, source unit12.06 and recorded total-0.48. Applied receipt history
explains0.4824 at48.24 per unit. Its remaining recognized monetary basis is0;
using the weighted source unit price again would count settled cost twice.

## Change ledger
One canonical resolver body provides the same approved-price source to authorized
operational writers. Report/source RLS and explicit financial visibility remain.
Browser roles cannot use its trusted operational mode or activate conversion.
No second price table, price source or per-sale debt queue was added.

New raw issues use last price including0. Physical lot/expiry selection retains
traceability and does not determine raw issue valuation. Quantity is normalized
once to the existing four-decimal physical/ledger/count precision and passed to
component snapshots. Currency rounding is allocated across lots so the complete
movement equals its rounded monetary total. The ledger rounding constraint
retains all other predicates, allowing the residual cent on an individual lot.

Kitchen capture reuses the indexed ledger records already written for that
event. Void/refund retains the frozen original movement. Purchase corrections
retain original document dates. Transfers quote and receive at the destination's
canonical operational price without widening invoice-history visibility.

New shortages use one aggregate stock position per coordinate. Existing debt
history is archived with its original settled quantity and source money intact.
Future counts ignore archived obligations and preserve effective dates. Owner-only
partial admission requires applied settlements, exact settled quantity, matching
recorded rounded money, matching weighted price and exact source/debt quantity.
Pending or mismatched evidence is rejected. Old administrative FIFO replay tools
fail before writes after cutover starts.

## Verification ledger
Exact #602 head eb2fa15ec9fc3d835ae64c0131361dac65b319c7:
-PR Verify41824803650: all4 jobs passed.
-Post-merge Verify41825590321: all4 jobs passed.
-Pages41826469641: build, production-parity and deploy passed.
-Merge:b6af68c111ccd5361f3a7f25464a4ab06d78fabf.

Exact #603 head6f0b7bff541317c34e1772cdee75e91ea72a0622:
-PR Verify41851319679: all4 jobs passed.
-Post-merge Verify41852574444: all4 jobs passed.
-Pages41853637144: build, production-parity and deploy passed.
-Merge:880cbf2c3a360af250316b226c148ef60e009089.

Focused final admission/count/transfer/price/recovery checks:53/53 across5 files,
2.57s. Includes rejecting invalid reconciliation evidence, preserving old money
and settled quantity, posting only current receipt variance, and strict-converter
rollback/reapply. Application/test typechecks, changed-file lint and API/worklog
contracts passed. Tests use owned rollback fixtures. Untaxed discount fixtures
explicitly set their intended tax within rollback transactions; production tax
or discount behavior was not changed. The unpublished768-dispatch October load
experiment is now explicit manual opt-in; behavioral/security cases stay mandatory.

Final authenticated same-transaction checks covered407 Smouha and402 Cleopatra
materials:0 quantity mismatches,0 canonical price mismatches and0 quantity-cache
mismatches in both branches. Source-money hashes and net quantities matched
before/after every coordinate conversion. The partial source still records-0.48
and settled quantity0.01. Original count posting timestamps remain08:02:58.735273Z
and08:03:13.79315Z on November4.

Send-core fingerprint remains09abdc1c2c47a48cc61d1dc3a310fe13. Security advisor
counts are unchanged:26 rls_enabled_no_policy,254 authenticated security-definer
execution findings and1 leaked-password protection finding. No new finding
category/count was introduced. No synthetic live business data was generated.

## Production gate
Completed with existing explicit owner approval and exact-head verification.
Applied production migration versions:
-20261104142855 raw_last_price_operational_cutover
-20261104145659 raw_last_price_partial_cutover
-20261104145834 raw_last_price_new_branch_defaults_enabled

Both branch defaults are active, with186 coordinate audits and1825 archived
obligations. New-branch trigger state isO (enabled). Browser activation remains
revoked. Source migrations use exact baseline guards and bounded lock/query
limits. Runtime default activation is recorded in
`scripts/rollout/raw_last_price_enable_new_branches_20261104.sql`.

## Recovery
Before any activation, `scripts/rollback/raw_last_price_operational_pre_activation_20261104.sql`
restores the modified definitions/ACLs only while the activation table is empty.
After activation, use `scripts/recovery/raw_last_price_operational_20261104.sql`
to restore verified writers while preserving business records and converted data.
`scripts/rollback/raw_last_price_partial_cutover_20261104.sql` restores only the
strict converter admission rule, without reversing stock or changing writers.
All paths were rehearsed. Never remove routing markers, fake a receipt by changing
settled quantities, or restore legacy writers against converted stock positions.

## Next action
No remaining deployment or conversion work. Retain the shared price/balance
sources and ordinary operational monitoring; do not replay the applied counts
or old FIFO tools. Physical lot history and old function names do not authorize
bringing manufacturing back into the normal component-group path.

## Mandatory update protocol
Record actual commits, CI, migrations and live checks. Preserve earlier released
work. Do not report an inactive candidate or a merged-only change as deployed.
Do not change another repository/project or generate production test orders to
produce verification evidence.
