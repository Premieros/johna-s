# Performance Stabilization — 2026-09-23

Repository: Premieros/johna-s
Branch: development/performance-stabilization-20260923
Base: main@d23f9101a0e283f8e21c3bd9e956a38ba0419311

## Goal

Reduce timeout risk and incomplete-search behavior without broad unmeasured rewrites.

## Safety

- No direct main edits.
- No Production migration/write before Full Verify green + explicit approval.
- Printing, print agents, receipt templates, and station routing are out of scope.
- Fix measured hotspots first; do not rewrite all list pages blindly.
- Fast Verify during development; Full Verify remains mandatory before merge.

## Reported critical baselines to verify

- inventory_ledger: ~7.85s
- get_costing_overview: ~7.96s
- get_raw_material_cost_overview: ~7.84s
- POS availability/sellability legacy functions: ~7.5–7.8s
- one cart path: up to ~34.2s
- get_income_statement: ~7.66s
- send_to_kitchen: ~7.58s
- settlement preview: ~7.54s
- create order: ~7.01s
- active orders: ~6.92s
- active shift: ~6.56s
- shift close report: ~6.45s
- get_kitchen_queue: ~6.24s

Legacy POS availability/sellability functions must first be proven to still be runtime callers before optimizing them.

## Stage A — list/query stabilization

Status: IN PROGRESS

1. Change shared pagination from exact-count paging to pageSize+1 paging.
2. Default first page from 200 rows to 50 rows.
3. Keep total unknown until the final page; do not force an expensive exact count.
4. Inventory Ledger:
   - narrow selected columns/relations;
   - push branch and entry-type filters to the server;
   - preserve historical minimum-date scope;
   - follow with complete server-side search rather than first-page local search.

## Stage B — critical runtime RPC profiling

Status: PENDING

For each active runtime path:
- prove current caller;
- collect repeated timings;
- inspect EXPLAIN/plan or function body;
- distinguish lock wait from query cost;
- add indexes/rewrite only where measurement supports it.

Priority:
1. send_to_kitchen
2. cart path with ~34s observation
3. create order
4. active shift / active orders
5. get_kitchen_queue
6. costing RPCs
7. income statement / settlement preview

## Stage C — correctness of large-list search

Status: PENDING

Replace pages that load a capped first page and then search/filter locally with complete server-side filters/search. Do this page-by-page, starting with measured or operationally important pages.

## Exit criteria

- Fast Verify green during iterations.
- No printing/runtime regressions.
- Inventory Ledger initial request is bounded and no exact count is required.
- Critical runtime paths have before/after evidence.
- Full Verify green before merge.
