# Report data clarity — 2026-10-25
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/report-data-clarity-20261025`
Current PR: #539
Last updated: 2026-10-25

## Work status
State: **BLOCKED**
Owner additionally requests financial permission fixes in this same PR. Owner authorizes software corrections only. User-entered classifications and missing prices are out of scope.

## Guardrails
Presentation only. Preserve all sales, POS permissions, kitchen/KDS, stock, accounting, payment, shifts and installed printers. No schema/RLS/migration or business-data writes; no production log scans. No new app reads.

## Baseline
Main `81d7db262632aadb2d35b02a20b4772e89d95107` (#538).

## Root-cause ledger
Dashboard report links omit selected dates. Filter totals use one-decimal general UI formatting while grids use two-decimal financial formatting. Month review incorrectly attributes price-only incompleteness to recipes/units. Expense category codes are displayed untranslated.

## Change ledger
Align manual journal, reconciliation, customer collection and supplier-payment controls/submit handlers with existing server-enforced action permissions. Recheck treasury action permissions before opening/submitting and hide revoked action dialogs. Clarify existing finance permission labels/effects; do not change role grants, permission keys, route read access or server guards. Read-only production function metadata confirmed journal/reconciliation/collection/payment permission keys. Deposit/withdrawal retain their existing frontend accounts.manage and server checks.

Pass existing selected dates to report links; consume existing ReportsPage URL date initialization. Use two-decimal financial summary/value display, retaining six-decimal quantities and unit prices. Show only applicable cost-completeness reasons without changing margin eligibility. Translate known expense category labels, preserving filter/storage values and custom labels. Do not edit user data or prices.

## Verification ledger
Read-only bounded production price-source audit checked all 806 material identities in the two branches (limit 1001). 250 lacked a current price across the entire catalog, not necessarily consumed. No missing current price had positive catalog default, positive pricing event, positive applied stock-count price, or positive valid completed-purchase item. Resolver uses the existing indexed approved-price projection. No positive-price/zero-report fault confirmed. UI audit before this change matched invoice/item/dashboard net totals and month review purchase/expense/consumption totals. 31 focused behavior/contract cases passed; application and test TypeScript, scoped ESLint, production build, identity check and whitespace checks passed. Report-only head passed all four CI jobs in run 40232431677 (1923 UI,1129 DB/security,136 browser). Financial additions: focused permission behavior and related contracts passed; new exact-head CI is required. React review: no new effects, subscriptions, requests, dependencies or permission changes; existing explicit-load behavior retained.

## Production gate
Owner requests including financial permissions in this same merge. Merge and publish the combined frontend package after exact-head checks pass. No production database changes are included or authorized.

## Next action
Run focused behavior/type/build checks and publish review candidate.

## Mandatory update protocol
One writer. Record exact head and CI evidence in the PR ledger; do not rerun broad suites for status-only updates.
