# Financial-history report fence — 2026-11-16

Repository: `Premieros/johna-s`
Branch: `security/financial-history-report-fence-20261116`
Production Supabase: `azzdesuowpdcoflmyezn`
Execution mode: **SINGLE_WRITER**
Parallel execution: **FORBIDDEN**
Unexpected HEAD policy: **STOP_AND_RECONCILE**
Write mode: **SEQUENTIAL_ONLY**

## Scope and status
State: **CANDIDATE / NOT DEPLOYED**.
Owner requests history visibility to constrain historical sales and sales-derived totals wherever the user lacks `history.unlimited`. Main remains untouched. Branch-local-first PR#638 is paused, not cancelled.
No production SQL/data writes, no merge, no business transactions, no print/KDS changes.

## Audited baseline
- `financial_visibility_sales` is an additive RESTRICTIVE authenticated SELECT policy; allowed recent rows are fully visible, older rows use a stable branch+sale-ID hash bucket and the configured historical percentage.
- `sale_items` and `sale_payments` have parent-linked restrictions.
- `get_dashboard_sales_snapshot` is SECURITY INVOKER and reads RLS-filtered sales.
- `get_sales_component_reconciliation_report` is SECURITY DEFINER and its `sales_scope` select does not explicitly call `private.financial_row_visible`. It exposes `summary.net_sales` from that scope, which can bypass RLS sampling.
- Other SECURITY DEFINER closing/financial reporting paths require individual privileged-read review. They are NOT certified by this narrow patch.

## Change ledger
1. Add fail-closed, no-business-data-write migration for the reconciliation report. Preserve existing body, ACL and owner; apply per-row history/branch visibility before every component/summary aggregation.
2. Add source contract regression tests.
3. Do not claim broader comprehensive enforcement or deploy before real authenticated permission tests and Full Verify.

## Release gates
- Verify canonical function text/fingerprint and migration in an owned Fresh/Test DB.
- Prove limited recent=100% and old=configured bucket sample, unlimited=100%, no unauthorized branch rows, and no complete net_sales via RPC.
- Review shift/day closing and other SECURITY DEFINER reporting separately; patch any verified holes before claiming end-to-end coverage.
- Exact-head Full Verify must be green and deployment needs separate owner approval.
