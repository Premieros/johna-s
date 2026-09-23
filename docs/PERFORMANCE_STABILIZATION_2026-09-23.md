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


## Production read-only findings — 2026-09-23

- pg_stat_statements is available.
- inventory_ledger: ~12,985 rows, ~5.4 MB total relation size.
- inventory_ledger already has branch+created_at plus single-column product/raw/warehouse/reference indexes.
- Historical weighted/max timings:
  - get_costing_overview: ~722 ms mean / 7,963 ms max
  - get_raw_material_cost_overview: ~1,108 ms mean / 7,839 ms max
  - get_income_statement: ~1,042 ms mean / 7,662 ms max
  - send_to_kitchen: ~625 ms mean / 7,578 ms max
  - get_pos_product_sellability: ~1,691 ms mean / 7,514 ms max
  - create_order: ~306 ms mean / 7,014 ms max
  - get_active_shift: ~80 ms mean / 6,556 ms max
  - get_kitchen_queue: ~108 ms mean / 6,240 ms max
- Current code has no src/ runtime callers for get_pos_product_sellability, check_pos_cart_availability, or check_product_availability. Treat these as legacy/compatibility for this stabilization; do not optimize them as POS startup paths.
- Current read-only EXPLAIN on Cleopatra:
  - get_costing_overview: ~841 ms for 498 rows.
  - _raw_cost_events_for_costing: ~27 ms for 434 rows, so it is not the main costing bottleneck by itself.
  - get_income_statement for 2026-09-01..2026-09-23: ~143 ms.
- get_active_shift and get_kitchen_queue have low weighted means despite historical spikes; do not rewrite stable runtime paths without a reproducible current spike.
- send_to_kitchen historical stats span multiple function versions. Keep the current kitchen/printing path frozen unless a current-version spike is reproduced.

## Stage A implementation status

- Shared usePaginatedRows exact count removed.
- Shared default page size reduced from 200 to 50, using one-row lookahead for hasMore.
- Inventory Ledger first page reduced to 50.
- Inventory Ledger selection narrowed to required columns and relation names only.
- Inventory Ledger branch and entry-type filters moved to the server.
- Full server-side ledger search across reference/batch/product/raw names remains pending; do not claim local search is complete yet.


## Stage B measurement update — Costing / cart / create_order / kitchen

Date: 2026-09-23
Branch: `development/performance-costing-history-bounds`
PR: #334

### Runtime-caller audit

- `get_costing_overview` is an active Costing Center caller.
- Costing Center also calls `get_costing_sales_summary` in parallel with the overview request.
- `get_pos_cart_product_availability` has historical Production samples at ~34.24s and ~65.87s, and its implementation performs an exponential + binary search for every active product by repeatedly invoking `check_pos_cart_availability`.
- Current `main` does **not** call `useCartAwareAvailability`; unit contracts explicitly keep cart availability out of POS quantity gating. Treat the 34s cart snapshot as a historical/legacy client hotspot unless a current caller reappears.
- `create_order` remains active. During this profiling window its pg_stat_statements call count increased by one and total time increased by only ~122ms, so the historical ~7.01s maximum was not reproduced.
- `send_to_kitchen` remains active. During this profiling window its call count increased by one and total time increased by ~655ms, so the historical ~7.58s maximum was not reproduced. The kitchen/printing path remains frozen.

### Costing measurements

Read-only Production measurements:

- `get_costing_overview`: ~450ms first observed run, then ~110ms and ~63ms; no current 7–8s spike reproduced.
- `get_costing_sales_summary`: ~920–947ms reproducibly on Cleopatra.
- Isolated COGS sources:
  - journal COGS: ~19ms
  - kitchen-event COGS: ~18ms
  - legacy inventory-ledger fallback: ~2.8ms
- Root cause: `history_clamp_from/to` were executed repeatedly inside the sales-row predicate. Those helpers reach `history_min_date()` / permission checks and created ~12k shared-buffer hits in the sales scan.
- Equivalent query materializing the two history bounds once reduced execution from ~947ms to ~51ms while preserving COGS precedence and history semantics.

### Fix in PR #334

- New migration: `20260923134500_costing_sales_summary_history_bounds.sql`.
- It evaluates `history_clamp_from/to` once in a `MATERIALIZED` CTE and reuses the resolved dates.
- `scoped_sales` is materialized once for the three COGS sources.
- SECURITY INVOKER, grants, COGS source precedence, and history permission semantics remain unchanged.
- Integration contract added to prevent per-row history-bound regression.
- No receipt, printer-agent, kitchen-routing, `send_to_kitchen`, or POS inventory behavior changes.
- Production migration status: **NOT APPLIED**. Full Verify green + explicit approval are required before any Production application.


## Stage C measurement update — raw material cost overview

Production read-only measurements after PR #334 deployment:

- Active UI caller confirmed in `CostingCenterPage.tsx` through `getRawMaterialCostOverview`.
- Historical PostgREST stats for `get_raw_material_cost_overview`:
  - calls: 19
  - mean: ~1347.58 ms
  - max: ~7838.51 ms
- Current authenticated Production measurement:
  - first observed cold run: ~1076 ms
  - warm reruns: ~85.5 ms, ~77.8 ms, ~79.8 ms
- Root cause isolated:
  - per-material `user_may_access_branch(rm.branch_id)`: ~117 ms for 402 active Cleopatra materials
  - equivalent single branch gate: ~2 ms
- Full equivalent query with an `accessible_branches AS MATERIALIZED` gate:
  - ~36.2 ms for the same 402 rows
- Exact correctness proof on Production data:
  - Cleopatra: 402 rows, current hash = optimized hash
  - all accessible branches for the tested authorized user: 803 rows, current hash = optimized hash
- Security semantics preserved:
  - AUTH_REQUIRED unchanged
  - `reports.costing` permission unchanged
  - explicit inaccessible branch still raises BRANCH_MISMATCH
  - all-branch mode still filters through `user_may_access_branch`
  - SECURITY DEFINER/search_path/grants unchanged
- Printing, printer agents, kitchen routing, `send_to_kitchen`, and POS sale/inventory behavior remain untouched.

Development branch:
`development/performance-raw-cost-branch-gate`

Production migration status:
**NOT APPLIED**. Full Verify + explicit approval are required before Production.
