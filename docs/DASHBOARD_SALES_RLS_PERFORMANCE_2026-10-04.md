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
- Child Financial Visibility remains RESTRICTIVE for both `sale_items` and `sale_payments`. Callers with sales access use parent `sales` RLS as the fast path; callers without `sales.view` retain the legacy `sale_read_visible_by_id()` fallback so limited-user behavior is preserved exactly.
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
- Exact-head CI run #3711 was Green before the limited-user fallback hardening; a new exact-head run is required after this change.
- Read-only child-predicate comparison before the payment fallback hardening found 0 item mismatches for all personas, and 4 payment predicate mismatches for the cashier persona; those payment differences were blocked by the existing permissive policy but the patch was hardened anyway to preserve the old restrictive predicate via fallback.
- Full after-migration RPC and child-table verification: pending because Preview/Staging was declined.

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
Obtain exact-head Full Verify Green after the limited-user fallback hardening. Preview/Staging was declined due to cost, so Production remains read-only and no migration is authorized until read-only equivalence evidence is complete and explicit approval is given.

## Mandatory update protocol
- Reconcile latest `main` before merge.
- Unexpected divergence => **STOP_AND_RECONCILE**.
- Keep State **BLOCKED** while the PR is open and until Production approval is explicit.
