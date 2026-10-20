# Sold products × current recipes × latest approved raw prices

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `feature/sold-recipe-consumption-20261020`
Current PR: pending
Last updated: 2026-10-20
State: **BLOCKED**

## Work status
Owner approves preparing a low-read report based on net sold products in the selected period, current recipes and latest approved raw prices. Production release needs separate approval after the concrete candidate and required checks.
## Guardrails
One writer. No changes to sale/order/kitchen/printing/stock/accounting writers, original movements/snapshots, RLS, grants on existing helpers, FIFO or Windows agents. No background refresh or extra write on sale. Existing actual consumption remains separate.
## Baseline
Main #526 `99deb5813eedb6554fffbf64ad8100f134428276`, deployed and all gates green.
## Root-cause ledger
October Smoha actual ledger consumption includes historical Mini Burger quantities of 750/300 stock kg on October 9. Current recipe is 0.15kg per sale unit (updated October16). Repricing those historical ledger quantities cannot provide current-recipe sold-item cost. This new view must not silently rewrite physical history.
## Change ledger
Reuse sales/sale_items, canonical recipe/group tables and the existing approved-price projection. Aggregate sold quantities before expanding recipes; materialize one set of required products and raws, and read prices once. A new guarded SECURITY INVOKER report handles manual paging/export in one bounded read, with full-result totals and explicit missing recipe/price/unit diagnostics. No new cache table, trigger or sale-side computation. Current recipes and latest prices explicitly revalue historical sales; operation-time snapshots remain untouched.
## Verification ledger
Pending focused tests, parity with the existing canonical recipe helper, extra restrictive-policy denial and bounded page/export checks. Supabase CLI unavailable; generate the unapplied migration with current UTC filename. No production mutation or full-month repeated probes.
## Production gate
لا Merge ولا Production migration before exact-head required checks and owner release approval. Candidate UNAPPLIED.
## Next action
Finish batch reader and UI, focused proof and PR, then required exact-head CI.
## Mandatory update protocol
Keep failures and current release state in this log/PR body. Never claim performance from synthetic results or treat missing recipe/unit data as a complete zero cost.
