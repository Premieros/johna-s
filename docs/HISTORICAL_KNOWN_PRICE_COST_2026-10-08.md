# Historical known-price costing — 2026-10-08

Repository Premieros/johna-s. Production johnas / azzdesuowpdcoflmyezn.
Single writer. Active branch fix/historical-known-price-cost-20261008.
Baseline main 5f08564187ba93507225a651164d311a2d77356b.

## Authorized objective
User requested correcting historical zero raw consumption costs where a known price
exists and recalculating previous sale profitability. Explicit clarification: stock may
be negative; consumed quantity times known price still counts as cost. No stock-balance
predicate is permitted in the calculation. Truly unpriced ingredients contribute zero
and other priced ingredients still sum.

## Evidence
Read-only Cleopatra audit: 4104 zero raw sale/kitchen consumption ledger movements,
3522 with currently known prices, gross reference estimate 29300.55. 4021 zero rows
have FIFO debt; 306 currently known price events postdate consumption. Initial net-sale
mapping found 3418 priced movements across 1324 invoices, reference estimate28499.49;
this initial audit is not the final correction total (legacy overlap/refund handling and
financial visibility can narrow it). Dates Sep20–Oct8. No historical ledger writes.
Raw chicken breast215/kg; manufactured210/kg. Current inventory balance does not
participate in any historical estimate.

## Implementation
New get_historical_sale_cost_estimates reporting RPC is STABLE SECURITY INVOKER,
requires auth, reports.costing, allowed branch, history bounds, existing RLS and explicit
Financial Visibility. It queries immutable consumption quantities, resolves kitchen
movements through the settled invoice, removes voided/refunded kitchen quantities,
prevents legacy/kitchen double counting, and prices distinct branch/raw sets through
get_raw_material_current_prices. Current stock tables are not joined.
Only unit_cost=0 AND total_cost=0 raw consumption is supplemented. Existing positive
actual costs are never replaced. After a receipt supplies actual cost, its zero supplement
disappears, preventing full settlement double counting. No new SECURITY DEFINER.
Legacy invoices with partial refunds are conservatively excluded from supplements
until exact per-raw refund linkage is verified; no refund-value proportion is guessed.
The raw period report switches its zero estimate source to the same canonical raw price,
retaining original guard/security/ACL and actual movement semantics.
Frontend summary and invoice margins separate actual cost, latest-known-price supplement,
total cost and corrected profit. Unpriced quantities do not suppress known costs.
Paginated historical RPC reads avoid the PostgREST row cap. Failed price reads are errors,
not zero supplements. Invoice amounts, journals, stocks, print/KDS/send/shifts untouched.
This is reporting correction, not a fabricated purchase receipt or booked actual FIFO cost.

## Validation / production gate
Targeted frontend checks cover mixed actual/zero ingredients, corrected profit, missing
price contribution, pagination and failed reads. DB tests cover negative/zero/positive
stock equivalence, latest price changes, kitchen voids, legacy overlap, real-cost replacement,
unknown raws and invoker/anonymous ACL. Full Verify pending.
Supabase CLI is unavailable locally; forward migration file created manually using the
established repository naming path. No new library/API features or dependencies used.
No migration applied. New Production reporting RPC requires separate explicit approval
after exact-head Full Verify Green. User approval of historical correction is retained;
only this new function/schema gate remains. Existing FIFO replay run3bdd6482 is not used.
