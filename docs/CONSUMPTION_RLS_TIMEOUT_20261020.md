# Consumption report timeout correction

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/consumption-rls-timeout-20261020`
Current PR: `525`
Last updated: 2026-10-20
State: **BLOCKED**

## Work status
The screenshot reports failure of #524 consumption reading. A narrow read correction is prepared; no production correction has been applied.
## Guardrails
One active writer. Preserve existing RLS, authorization outcomes, history visibility, stock/accounting and all printing/operational writers. No new SECURITY DEFINER or role grants.
## Baseline
Main #524 / `2d41146d013481cbaaeefad4e1d7c0f1f116cbcd`. Report body hash `701383f18b6239276843f33448bf7b5a`.
## Root-cause ledger
PostgreSQL 57014 occurs in repeated financial-reference authorization. The new reader duplicates an already mandatory restrictive ledger policy.
## Change ledger
Remove the duplicate predicate only. Check the exact policy, authenticated coverage and enabled RLS once per call. Fail closed on change. Guarded exact-hash rollback provided.
## Verification ledger
Real caller-role isolated PostgreSQL: visibility calls 6 to 3, identical rows/totals, extra restrictive policy honored, changed baseline rejected, exact rollback. Types/lint passed. Initial CI app gate detected the stale mandatory log pointer; corrected to this log without weakening the gate. Full canonical DB and browser outcomes are recorded in the PR body.
## Production gate
No Merge ولا Production migration before required exact-head checks and applicable owner release approval. Original #524 approval/release is recorded; this correction has not been applied.
## Next action
Finish exact-head CI and obtain release authorization where required before the report-only migration. Then one bounded real-caller production measurement; no repeated full-month diagnosis probes.
## Mandatory update protocol
Record real failures/skips and current release status in this log/PR body. Do not claim a production performance result from a synthetic test.

Repository: Premieros/johna-s. Database: azzdesuowpdcoflmyezn only.
Baseline: release #524 / 2d41146d013481cbaaeefad4e1d7c0f1f116cbcd.

The owner supplied a screenshot of the Smoha October consumption report timing out. PostgreSQL logs confirm 57014 inside financial_reference_visible → financial_row_visible → user_may_access_branch/can_permission. The report explicitly repeated the exact financial-reference predicate already enforced by inventory_ledger's existing restrictive SELECT policy.

The correction changes only get_consumption_latest_report's read body. It removes the duplicate predicate, leaving existing restrictive RLS to apply once, and checks the exact unchanged policy identity/qualification, authenticated role coverage and enabled RLS once per call. If the policy baseline changes, the RPC fails closed. No policy, writer, permission grant, stock/accounting value, kitchen operation or printing code changes.

The local Supabase CLI is unavailable; the new migration filename was generated from the current UTC timestamp. The migration checks the exact deployed read-body hash and preserves SECURITY INVOKER. Rollback reverses only this read optimization and verifies the exact original body hash.

Isolated PostgreSQL caller-role proof: three source rows required six visibility calls before and three after. Rows and complete totals were identical. A second restrictive policy still hid the protected material; a changed required policy was rejected. The report rollback recovered the exact original read-body hash. Existing quick-order/report/rollback proofs also passed. Typecheck passed.

Canonical integration additionally checks restrictive-RLS denial and fail-closed behavior under the actual schema. Production release/measurements and final CI are recorded in the PR body. No repeated full-month production probes during diagnosis.
