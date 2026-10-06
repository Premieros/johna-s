# DASHBOARD REFRESH — ACTIVE WORK LOG
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/dashboard-refresh-20261006`
Current PR: `#463`
Last updated: 2026-10-06

## Work status
State: **BLOCKED**
User authorized repair and review of related dashboard failures. Publishing gated.

## Guardrails
Single writer; no agents. Frontend/read-only service changes only. No migrations,
new APIs, RLS/Financial Visibility/branch/history changes, SECURITY DEFINER,
printing, KDS, send_to_kitchen, sales mutations, stock/FIFO, accounting,
settlement or shift changes. No live sales, send or printing tests.
All automations and Usage Watch remain disabled. No new polls/realtime listeners.

## Baseline
Main 247e65de5c0c8b6c6be7a8855b174469fbfab4e1 (#462 deployed and verified).
Separate clean worktree. Unexpected head movement => STOP_AND_RECONCILE.

## Root-cause ledger
Read-only Smouha snapshot: six active populated orders totaling EGP 1794,
no recorded sale in Cairo's Oct 6 calendar day at inspection. Zero recorded
sales is valid; zero open-order value in the screenshot is inconsistent.
Confirmed source defects: Refresh invokes only sales load; operations/stock/
finance effects never reload on manual Refresh. Operational read errors collapse
to empty rows/zero; rejected reads can leave loaders unfinished. Old operations
remain visible during branch changes. Exact browser request failure is unobserved;
do not assert that a timeout/RLS denial caused this screenshot.

## Change ledger
One manual refresh re-evaluates the selected Cairo calendar window and reloads
sales, operations, finance and stock under existing permissions/filters. Disable
Refresh until all sections settle to prevent overlap; add no polling or automatic
retries. Clear scope values on reload and discard late responses using existing
request/cancellation guards. Return independent read-failure indicators, keep
successful unrelated values, show unavailable values as — and a retry notice.
Sales fallback errors/previous comparison/product detail and payment failures
are distinguished; failures are not presented as actual empty data/zero deltas.
Rejected requests settle loading state and can retry manually. Sales count,
average and recent-list labels identify registered invoices rather than open orders.

## Verification ledger
Targeted component tests cover all-section refresh, independent partial failures,
retry, busy-button suppression, late branch replies and rejected requests.
Service tests cover PostgREST error/rejection, existing branch/status predicates,
no unauthorized reads, stock retry, comparison and product-detail failures.
Application/test type checks, changed-file lint, build and targeted tests required.
Exact-head Full Verify must pass unit/DB/security/browser and Pages continuity.
No claim of a complete live audit of every POS/ERP workflow.

## Production gate
State: **BLOCKED**
No DB apply. No merge/deploy until exact-head Full Verify green and explicit
approval for this concrete frontend scope. Preserve existing assets on publication.
This fix adds the missing reads only for explicit refresh; no recurring load added.
Rollback frontend normally. No historical or operational data rewrite.

## Next action
Finish validation and draft PR, record exact tested head/CI in PR metadata and
request publication approval when fully green.

## Mandatory update protocol
Check main/head before writes. Unexpected movement => STOP_AND_RECONCILE.
Record final CI and approval in PR metadata without changing the tested head.
