# Consumption report timeout correction

Repository: Premieros/johna-s. Database: azzdesuowpdcoflmyezn only.
Baseline: release #524 / 2d41146d013481cbaaeefad4e1d7c0f1f116cbcd.

The owner supplied a screenshot of the Smoha October consumption report timing out. PostgreSQL logs confirm 57014 inside financial_reference_visible → financial_row_visible → user_may_access_branch/can_permission. The report explicitly repeated the exact financial-reference predicate already enforced by inventory_ledger's existing restrictive SELECT policy.

The correction changes only get_consumption_latest_report's read body. It removes the duplicate predicate, leaving existing restrictive RLS to apply once, and checks the exact unchanged policy identity/qualification, authenticated role coverage and enabled RLS once per call. If the policy baseline changes, the RPC fails closed. No policy, writer, permission grant, stock/accounting value, kitchen operation or printing code changes.

The local Supabase CLI is unavailable; the new migration filename was generated from the current UTC timestamp. The migration checks the exact deployed read-body hash and preserves SECURITY INVOKER. Rollback reverses only this read optimization and verifies the exact original body hash.

Isolated PostgreSQL caller-role proof: three source rows required six visibility calls before and three after. Rows and complete totals were identical. A second restrictive policy still hid the protected material; a changed required policy was rejected. The report rollback recovered the exact original read-body hash. Existing quick-order/report/rollback proofs also passed. Typecheck passed.

Canonical integration additionally checks restrictive-RLS denial and fail-closed behavior under the actual schema. Production release/measurements and final CI are recorded in the PR body. No repeated full-month production probes during diagnosis.
