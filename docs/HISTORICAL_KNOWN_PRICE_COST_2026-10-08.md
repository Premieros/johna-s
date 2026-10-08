# Historical known-price costing — 2026-10-08

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/costing-report-read-load-20261008`
Current PR: #471
Last updated: 2026-10-08

## Work status
Implementation prepared. State: **BLOCKED** for production pending verification and the separate new-function approval.

## Guardrails
Single writer. Preserve RLS, Financial Visibility, branch isolation, inventory, accounting,
printing, KDS, send and shifts. No direct main writes, force pushes or SECURITY DEFINER shortcuts.

## Baseline
Main 5f08564187ba93507225a651164d311a2d77356b, approved #469 deployed and fully verified.

## Authorized objective
User requested correcting historical zero raw consumption costs where a known price
exists and recalculating previous sale profitability. Explicit clarification: stock may
be negative; consumed quantity times known price still counts as cost. No stock-balance
predicate is permitted in the calculation. Truly unpriced ingredients contribute zero
and other priced ingredients still sum.

## Root-cause ledger
Read-only Cleopatra audit: 4104 zero raw sale/kitchen consumption ledger movements,
3522 with currently known prices, gross reference estimate 29300.55. 4021 zero rows
have FIFO debt; 306 currently known price events postdate consumption. Initial net-sale
mapping found 3418 priced movements across 1324 invoices, reference estimate28499.49;
this initial audit is not the final correction total (legacy overlap/refund handling and
financial visibility can narrow it). Dates Sep20–Oct8. No historical ledger writes.
Raw chicken breast215/kg; manufactured210/kg. Current inventory balance does not
participate in any historical estimate.

## Change ledger
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
Production inspection confirms the existing raw period report already uses the canonical
raw price source after #467. Its source, guards/security/ACL and actual movement semantics
are preserved; no replacement patch is needed.
Frontend summary and invoice margins separate actual cost, latest-known-price supplement,
total cost and corrected profit. Unpriced quantities do not suppress known costs.
A scalar JSON historical RPC response avoids the PostgREST set-row cap and paging drift. Failed price reads are errors,
not zero supplements. Invoice amounts, journals, stocks, print/KDS/send/shifts untouched.
This is reporting correction, not a fabricated purchase receipt or booked actual FIFO cost.

## Verification ledger
Targeted frontend checks cover mixed actual/zero ingredients, corrected profit, missing
price contribution, complete responses above the row cap and failed reads. DB tests cover negative/zero/positive
stock equivalence, latest price changes, kitchen voids, legacy overlap, real-cost replacement,
unknown raws and invoker/anonymous ACL. Full Verify pending.
Supabase CLI is unavailable locally; forward migration file created manually using the
established repository naming path. No new library/API features or dependencies used.
No migration applied. New Production reporting RPC requires separate explicit approval
after exact-head Full Verify Green. User approval of historical correction is retained;
only this new function/schema gate remains. Existing FIFO replay run3bdd6482 is not used.

## Production gate
No new reporting function/migration applied. Separate explicit approval is required after
exact-head Full Verify Green. Existing user authorization for historical costing persists.

## Next action
Complete exact-head CI, resolve meaningful failures, then seek approval for the concrete
new guarded reporting RPC. Apply/merge/deploy only after approval.

## Mandatory update protocol
Update this log for verification transitions. Reconcile unexpected main/head movement.
No parallel writers. Record final exact-head evidence in PR metadata to avoid a documentation/CI loop.

## Latest verification checkpoint
6ae3f119 Verify37766229409 stopped at the mandatory worklog structure guard before code/DB
execution; this update supplies the required headings and branch/PR metadata. Targeted8
frontend tests and typechecks/lint succeeded. Refined read-only audit matching the new
movement selection:1334 invoices including unpriced-only invoices,3418 priced movements,
570 unpriced movements,28497.72 known-price supplement. This is reference costing;
Financial Visibility and a live cutoff can change the authorized report totals.

Production preflight confirmed the old fallback expression had already been replaced by
#467 with get_raw_material_current_prices. Removed the redundant proposed period-function
patch before further CI; the new migration creates only the guarded historical RPC.

Fixture preflight supplies required price-event reference_number values before fresh-DB
execution. Confirmed live invoice Johna's-02577: coffee6.60 plus two zero-cost sugar packets
at current0.211 each yields7.02; no invoice or source movement mutated.

Final response hardening: RPC returns a scalar JSON array computed in one database
snapshot, avoiding set-returning row truncation and concurrent paging drift. API/UI keep
the same array model; targeted tests include1200 invoices returned in one call.

## Post-deployment performance follow-up
User separately approved Production RPC and publication at14:20 Cairo. #470 merged
b2bb81eb, exact premerge Verify37767885053 passed1563/960/121; Pages37769445145 succeeded.
Migration historical_known_price_cost_estimates applied; INVOKER/anon-denied verified.
Live month overview hit8s timeouts under concurrent reads; each canonical historical RPC
read succeeded in isolation at about4–5s. Current valuation and summary reads also succeed
individually. Sequence historical pricing after existing overview reads and after order
margins, preserving stale-request checks, costing and all permissions. No new DB change.
Targeted verification and new exact-head Full Verify pending. Publication authorization
for this necessary follow-up is retained from the user's explicit approval.

Follow-up PR: #471. Targeted9 tests, full typechecks and changed-file lint passed.
Exact-head CI pending; do not merge until Green. #470 is approved/applied/deployed.
