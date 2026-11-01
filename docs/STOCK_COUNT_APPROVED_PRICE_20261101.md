# Stock count approved-price valuation — 2026-11-01
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/stock-count-approved-price-preflight-20261101`
Current PR: #569
Last updated: 2026-11-01
State: **BLOCKED**

## Work status
Owner approved phased migration: first current November counts using the existing last-approved-price service (zero is an accepted known price); subsequently transition all raw costing from FIFO to approved-last-price without deleting historical transactions.

## Guardrails
Preserve approved historical entries, stock count drafts, role authorization, branch isolation, stock debt and financial journals. No production application from a candidate. No synthetic fixtures on production.

## Baseline
Stock count #00008 Smouha and #00009 Cleopatra are drafts; production apply_stock_count debits shortages using _raw_remove_fifo and FIFO-derived total_cost, contrary to owner policy.

## Root-cause ledger
The current system has private.latest_approved_raw_prices, used by get_raw_material_current_prices. FIFO removes batches at historical costs, so replacing only journal valuation with last price creates ledger-vs-journal mismatch. Existing database allows negative raw quantities but stock count's current removal does not pass allow_negative=true. Candidate still fails closed until a coherent movement and journal writer is tested.

## Change ledger
Branch adds read-only audit SQL, owner price policy gates, and a NOT-FOR-PRODUCTION candidate function reusing central approved-price source and zero-compatible fallback, rejecting ledger/accounting valuation mismatches and raising exceptions on failed items. Unit source contract tests added. Plan points to this active worklog.

## Verification ledger
Verify main run 41284835313: verify failed because activeWorklogGateContract referred to previous #567 branch. Resolved plan pointer and created this matching log. New exact-head four-job run required. No disposable Postgres integration verification of valuation or operator-level approval/apply has passed.

## Production gate
BLOCKED. Requires detailed ledger and accounting correction for shortage/negative quantity, full rollback transaction, test fixtures, peer review, exact-head CI, and verified production release. Only then approved authorized counts may be posted.

## Next action
Design existing-writer-only valuation bridge with _raw_remove_fifo legacy FIFO batch consumption and explicit price variance reconciliation, or re-use guarded v2 costing after all migration gates. Verify complete posting on disposable Postgres before main merge and live application.

## Mandatory update protocol
Every material change must update this ledger and validate current PR branch, CI, and deployment gate. Never report a production rollout without exact runtime proof.

## Existing adjustment-path inspection — 2026-11-01
Verified production public.adjust_raw_stock: it is branch-aggregate rather than warehouse-scoped, values increases at avg_cost and decreases with _raw_remove_fifo(total_cost), and posts its own journal. It cannot safely substitute for stock count's warehouse-specific valuation without wrong warehouse movement, duplicated accounting, and same FIFO discrepancy. Do not route November counts through adjust_raw_stock. Use the central approved-price resolver but retain stock-count's scoped movement and single journal with a properly tested price-variance bridge.

## Reporting consumer verification — 2026-11-01
Read-only production function inspection confirms public.get_raw_material_consumption_report uses a visible_ledger CTE and SUM(total_cost) for opening_value, period.net_value and other_net_value. The proposed zero-quantity 'revaluation' entry is included in net/other value rather than sales-consumption value (which filters sale/kitchen_send). This supports the algebra of closing_value but is NOT a full integration test: visibility via private.financial_reference_visible, time cutoffs, other reports, actual FIFO debt settlement, and _raw_add receipt settlement need explicit test coverage. The candidate remains OFF and unmerged.
