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

## Additional read-only production evidence (2026-11-16)
Catalog inspection in the linked Johna's Supabase production project:
- All seven scoped read RPCs are currently SECURITY DEFINER with no direct `private.financial_row_visible` in `prosrc`: component reconciliation, payment report, financial reconciliation, shift tenders, day-close report, day-close range report, shift-close report.
- Actual function-definition anchors for the candidate replacements were checked against production: archived predicates 2 in payment report, 1 in financial reconciliation, 1 in component reconciliation; shift-tender `WHERE st.amount>0` appears twice; day-close replacement anchor appears once.
- `daily_closes_select` allows admin or own branch without a historical constraint. A historical `report_snapshot` can therefore expose complete saved financial totals. Current shift operations have an existing restrictive `financial_visibility_shift_operations` policy for sale/refund references, and shifts have a restrictive historical policy. Do not remove these.
- No production table rows or business records were read or written; only pg_catalog function/policy metadata was consulted.

## Additional candidate fixes
- `20261116153000_settlement_reports_history_visibility.sql`: fence two payment-report sales scans and the financial reconciliation sales_scope.
- `20261116154000_shift_tender_history_visibility.sql`: constrain both shift-tender aggregations to the same canonical sale predicate.
- `20261116155000_day_close_snapshot_history_guard.sql`: deny historical pre-aggregated day snapshots to limited viewers through both read RPC and table RLS, retaining complete stored operational accounting.
- `20261116160000_shift_closing_history_guard.sql`: deny older full shift summaries for limited viewers without altering shift-close writers.
- Integration coverage extended for the three reconciliation APIs, direct daily_closes, day closing and shift report denial.

## Important behavior
Older full closing snapshots cannot truthfully return the configured *invoice sampling percentage* without being rebuilt from authoritative rows. The candidate FAILS CLOSED for older stored day/shift close reports rather than exposing complete totals, while ordinary sales and payment report rows use the deterministic configured percentage. UI explanation should be reviewed before production release. Do not treat a denied snapshot as a zero-value sales day.

## Verification status
Production remains unchanged; no migration applied. Earlier PR Verify run was superseded/cancelled by later candidate commits and cannot be taken as a successful gate. Exact-head native CI Fresh DB, runtime and browser checks must be green at the final commit; no release claim until then. Need ensure other privileged reports / exported financial data do not disclose unauthorized aggregate history.

## Privileged sales reader sweep
A read-only production pg_catalog search found other authenticated SECURITY DEFINER entry points reading `public.sales`. Categorized as:
- Mutators/printing/refunds: out of read-visibility scope; no changes to business operations or print.
- `get_raw_material_financial_report`: already filters the sale calculation through `private.financial_reference_visible`; review helper semantics in full integration test.
- `get_branch_activity_snapshot`: privileged management dashboard aggregates full sale counts/amounts; added `20261116161000_branch_activity_history_visibility.sql` to constrain only the sale LEFT JOIN by `private.financial_row_visible`.
- `get_system_health_snapshot`: exposes diagnostic discrepancy counts rather than total sales; preserve operational diagnostics, requires separate assessment.
- `get_branch_treasury_day_close_reconciliation`: ledger-derived whole-history financial reconciliation, requires separate scope/permission review before declaring complete cross-report proof.
Exact production pg_get_functiondef anchor checks matched all candidate source patterns. No business table SELECTs were used in production.

## Final candidate checklist
- [x] Protect direct sales, sale items, payments with existing RESTRICTIVE RLS (source reviewed).
- [x] Candidate explicit sale filtering in component, payment, finance, shift-tender and branch-activity reports.
- [x] Candidate fail-closed limits on historic full stored day/shift reports, preserving stored accounting truth.
- [x] Integration tests for limited/unlimited with equal reporting permissions and direct snapshot reads (written, NOT yet proven green).
- [ ] Exact-head Fresh/Test DB migration and security test success.
- [ ] Verify CI all jobs green.
- [ ] Review whole-history treasury and diagnostic paths for legitimate access and unintended sale visibility.
- [ ] Separate release approval, guarded Production apply and authenticated read-only smoke proof.

## Whole-history treasury reconciliation guard
Production pg_catalog confirms `get_branch_treasury_day_close_reconciliation` returns `cash_sales`, `bank_sales`, `credit_sales`, `net_sales` and historical opening/closing balances from unfiltered journal movements. A full ledger balance cannot be truthfully sampled by invoice percentage. Added candidate `20261116162000_treasury_historical_reconciliation_permission.sql` to require `history.unlimited` for the entire privileged historical treasury reconciliation RPC, with a limited-user denial test. No treasury/posting/close writer is changed. User-facing consequence: limited users must use permission-scoped sales reports for partial historical figures; they cannot open this complete-balance reconciliation.
