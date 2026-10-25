# Report data clarity — 2026-10-25
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/report-data-clarity-20261025`
Current PR: #539
Last updated: 2026-10-25

## Work status
State: **BLOCKED**
Owner authorizes software corrections only. User-entered classifications and missing prices are out of scope.

## Guardrails
Presentation only. Preserve all sales, POS permissions, kitchen/KDS, stock, accounting, payment, shifts and installed printers. No schema/RLS/migration or business-data writes; no production log scans. No new app reads.

## Baseline
Main `81d7db262632aadb2d35b02a20b4772e89d95107` (#538).

## Root-cause ledger
Dashboard report links omit selected dates. Filter totals use one-decimal general UI formatting while grids use two-decimal financial formatting. Month review incorrectly attributes price-only incompleteness to recipes/units. Expense category codes are displayed untranslated.

## Change ledger
Pass existing selected dates to report links; consume existing ReportsPage URL date initialization. Use two-decimal financial summary/value display, retaining six-decimal quantities and unit prices. Show only applicable cost-completeness reasons without changing margin eligibility. Translate known expense category labels, preserving filter/storage values and custom labels. Do not edit user data or prices.

## Verification ledger
Read-only bounded production price-source audit checked all 806 material identities in the two branches (limit 1001). 250 lacked a current price across the entire catalog, not necessarily consumed. No missing current price had positive catalog default, positive pricing event, positive applied stock-count price, or positive valid completed-purchase item. Resolver uses the existing indexed approved-price projection. No positive-price/zero-report fault confirmed. UI audit before this change matched invoice/item/dashboard net totals and month review purchase/expense/consumption totals. 31 focused behavior/contract cases passed; application and test TypeScript, scoped ESLint, production build, identity check and whitespace checks passed. Full unit suite and exact-head CI pending. React review: no new effects, subscriptions, requests, dependencies or permission changes; existing explicit-load behavior retained.

## Production gate
Prepare review candidate; no merge or production migration without final release authorization and exact-head checks.

## Next action
Run focused behavior/type/build checks and publish review candidate.

## Mandatory update protocol
One writer. Record exact head and CI evidence in the PR ledger; do not rerun broad suites for status-only updates.
