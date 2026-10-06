# USER REPORTS, PERIODS AND PRICING — ACTIVE WORK LOG
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/dashboard-periods-count-pricing-20261006`
Current PR: `#458`
Last updated: 2026-10-06

## Work status
State: **BLOCKED**
User requested combining dashboard defaults/periods, missing Excel count prices,
expense account reporting and dated Costing Center reports. Implementation is prepared;
exact-head Full Verify and explicit Production DB approval remain required.

## Guardrails
Single writer; no direct main writes/force push. No Production data changes or live
sales/kitchen sends/print tests. Preserve RLS, history visibility, Financial Visibility,
POS/KDS/printing/Print Agent/shifts/stock application/FIFO/accounting contracts.
No historical count, batch or journal rewrites. Usage Watch remains disabled.

## Baseline
Main 589cb22e50aa2cc4069c49f4d12cb35b5bbabe3d. #456 and #454 complete.
Post-merge Verify 37341254404 and Pages 37341254396 succeeded. Unexpected source movement
requires STOP_AND_RECONCILE.

## Root-cause ledger
The live dashboard is DashboardDataPage, not the legacy VisualDashboardPage.
It defaults to month/week by history permission; accounting cards always read current month;
operational purchases/expenses have no end boundary. Excel count parser ignores price columns,
create_stock_count uses warehouse avg_cost. Expense report omits account_id relation.
Costing sales summary ignores order-date fields; existing consumption RPC already accepts dates.

## Change ledger
Today default; existing week/year retained; this/previous calendar month and applied custom dates.
One Cairo period shared by sales/accounting/purchases/expenses/chart; stale reads discarded.
Stock alerts/open order value remain explicitly current operational snapshots.
Expense report embeds existing account relation through RLS; unavailable account never invented.
Costing summary/order margins follow applied from/to dates; new consumption period report uses
existing RPC and separates actual/estimated costs. Current recipe/supplier prices remain snapshots,
not a reconstructed historical price/recipe valuation.
Optional stock-unit price in Excel/manual draft with positive-value/conflict checks and unit label.
Proposed migration changes only the raw-item cost assignment in existing create_stock_count,
preserving its guards/privileges. Normal submit/approve/apply required for count costing events.
Unchanged quantities do not revalue old FIFO batches. Old discarded Excel prices are unrecoverable
from database alone: any historical correction must be reconciled separately from the original file.

## Verification ledger
Local full unit/component suite passed: 304 files / 1480 tests. Application typecheck and initial build passed; final test typecheck/build and exact-head CI pending. New component tests verify shared period parameters;
unit tests cover Cairo/DST/end-date/leap-year/invalid inputs and account identity. Isolated DB lifecycle
test verifies explicit price, draft invisibility, normal apply, zero-variance cost event, no batch repricing.
No Production queries or writes are performed by these tests.

## Production gate
State: **BLOCKED**
Migration proposal: 20261006055330_raw_stock_count_explicit_unit_cost.sql. Separate explicit approval
required before any Production apply. Before approval capture live function definition/hash/grants;
reconcile its exact baseline and retain the captured definition for rollback. No deployment before
backend availability and exact-head Full Verify. No automatic migration application.

## Next action
Finish local checks, bind real PR, pass exact-head Full Verify, present concrete approval scope.
Heavy-report aggregation, supplier/purchase permission review, costing/accounting #445 and
period/recovery reviews stay in the consolidated backlog and are not silently applied.

## Mandatory update protocol
Record exact CI/head evidence in PR metadata without changing the tested commit.
Stop/reconcile unexpected main/head movement; keep this log and CURRENT_WORK_PLAN linked.
