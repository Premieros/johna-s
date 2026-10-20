# Reports: aligned totals, useful filters and purchase materials

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/report-filters-totals-20261020`
Current PR: `526`
Last updated: 2026-10-20
State: **BLOCKED**

## Work status
Owner reports missing aligned column totals, ineffective advanced filters, missing date ranges and purchases limited to invoice/supplier headers. Preparing one corrective candidate, no production change.
## Guardrails
One writer; preserve RLS, SECURITY INVOKER and all operational/printing/accounting/stock writers. No production mutation or merge without explicit release approval. Focused local tests; required release gates remain.
## Baseline
Main `44a8b9f72e56d63386490719321c0995076ccc73`; #525 deployed and all gates green. Its production real-role consumption read succeeded in 6683ms; no universal latency guarantee.
## Root-cause ledger
Operational and consumption footers use a colspan summary instead of aligned cells. Core RPC already returns complete metrics but the client drops them. Filter lists require a selected branch and nested collapsed controls hide useful fields. Purchase source has invoice headers only. Party statement omits its from-date input despite passing that date to its reader.
## Change ledger
Prepare aligned full-result additive column totals, visible period controls and useful scoped filters, purchase material/category/supplier views through the existing bounded caller-RLS source. Material line values use recorded line returns, explicitly before invoice-level discount/tax. Invoice counts across split payment methods are also non-additive, avoiding a duplicated invoice count. Current balance reports remain as-of/current, not falsely period-filtered.
## Verification ledger
228 focused reporting tests passed; app/test types and production build passed. First focused assertions were updated for the deliberately added print total row and aligned consumption export key; the new page-alignment test required the mock to supply the real RPC's full metrics instead of inventing a page subtotal. No assertion weakened. Mandatory log gate passed 4/4 after assigning PR #526; current release state is maintained in the PR body.
Isolated PostgreSQL uses the real existing reader plus the candidate migration as authenticated: invoice totals 180 versus explicitly named recorded line values 260 before invoice-level discount/tax; material/category/supplier filters, cross-page/full metrics, export source, foreign-branch denial and an extra restrictive line policy all passed. Rollback restored the exact original function hash. Exact-head 96fa50d1 CI DB/RLS passed 1108/1108 including all three new real-schema cases. Application CI passed 1847 tests but one old static assertion expected the old three-dependency scope; updated it for the added permitted-branch key and added behavioral coverage for stable versus changed branch lists. Browser CI passed 133/134; its old report fixture omitted the real RPC metrics and asserted the former merged footer count. Fixture now supplies full metrics and checks per-column full totals on both pages, retaining phone/desktop pagination, no-full-read, sticky header and pinned-column assertions. Fresh exact-head CI remains required. No production performance or browser-visual claim.
Changed-file lint: 0 errors, two existing FinancialReportsPage dependency warnings. React review: manual requests retained, stable primitive filter-scope key, request cancellation forwarded, controls labelled, footer cells follow visible/reordered columns, no new dependency or shared UI/operational component changes.
Supabase CLI remains unavailable; UTC migration filename generated locally for the unapplied review candidate, as in #525. No CLI install or telemetry retry. Required production approval remains separate.
## Production gate
No Merge ولا Production migration until reviewed exact-head required checks and explicit owner release approval. Candidate migration is UNAPPLIED.
## Next action
Run exact-head CI on PR #526, resolve actual failures without weakening gates, then request approval for the concrete read-only report migration plus frontend release.
## Mandatory update protocol
Record failures and limitations honestly. Update this log/PR body before release. Do not weaken required gates or sum mixed units/prices/balances as if additive.
