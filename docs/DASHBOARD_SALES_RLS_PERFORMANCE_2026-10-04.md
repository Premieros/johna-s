# DASHBOARD / SALES RLS PERFORMANCE — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `perf/dashboard-sales-snapshot-rls`
Current PR: `#444`
Last updated: 2026-10-04

## Work status
State: **BLOCKED**

Performance-only work on Dashboard/Sales read paths. Production remains read-only until explicit approval after Preview/Staging evidence.

## Guardrails
- No Production database mutation.
- Preserve Permission-First, branch isolation and Financial Visibility exactly.
- No new SECURITY DEFINER shortcut to bypass RLS.
- No changes to Printing, Print Agent, KDS, Send to Kitchen, Inventory, Accounting, Settlement or Shifts.
- No Merge before exact-head Full Verify Green and explicit approval.

## Baseline
- Main baseline: `3c9e3cf1f2bac05dab346a33b7af53b0adeef77a`.
- Production Dashboard wide-range baseline: ~3.73 s, ~93,458 shared buffer hits.
- Isolated current sale visibility predicate: ~455 ms, 10,849 shared hits.
- Existing indexes already cover `sales(branch_id, created_at)`, `sale_items(sale_id)`, and `sale_payments(sale_id)`.

## Root-cause ledger
1. `sales` Financial Visibility re-evaluates branch authorization, `history.unlimited`, and visibility settings for each scanned row.
2. `sale_items` and `sale_payments` call `private.sale_read_visible_by_id(sale_id)` per child row, reopening the parent sale and repeating the same authorization chain.
3. The slowdown is therefore dominated by repeated RLS/authorization work rather than a missing basic index.

## Change ledger
- Added `20261004090000_dashboard_sales_rls_context_cache.sql`.
- Statement-constant checks are expressed as scalar SELECTs so PostgreSQL can plan them as initPlans.
- Child Financial Visibility remains RESTRICTIVE and is inherited through parent `sales` RLS instead of per-child `sale_read_visible_by_id()` re-entry.
- Added explicit rollback SQL.
- Added unit contract covering Permission-First, Financial Visibility, child inheritance, rollback and operational-path isolation.
- No Production apply has occurred.

## Verification ledger
- Production read-only row-by-row equivalence over 1,854 sales:
  - branch_manager: 0 mismatches
  - super_admin: 0 mismatches
  - cashier: 0 mismatches
- Equivalent isolated predicate benchmark: ~120 ms / 3,886 shared hits versus ~455 ms / 10,849 before.
- PR #444 first CI run failed only because the mandatory worklog still referenced the previous branch; runtime checks were not reached.
- Exact-head CI: pending after worklog reconciliation.
- Full after-migration RPC and child-table verification: pending Preview/Staging.

## Production gate
State: **BLOCKED**

No Production migration is authorized. Required evidence before any Production proposal:
1. same visible rows before/after for representative users;
2. unchanged branch isolation;
3. unchanged Financial Visibility;
4. no additional rows for limited users;
5. clear Dashboard and sale_items latency improvement;
6. no HTTP 500 / PostgreSQL 57014;
7. tested rollback.

## Next action
Obtain exact-head Full Verify Green. After explicit acceptance of the Supabase Preview branch cost, create Preview/Staging, apply the migration there, and run equivalence plus before/after performance verification.

## Mandatory update protocol
- Reconcile latest `main` before merge.
- Unexpected divergence => **STOP_AND_RECONCILE**.
- Keep State **BLOCKED** while the PR is open and until Production approval is explicit.
