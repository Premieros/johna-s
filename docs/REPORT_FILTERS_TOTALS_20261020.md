# Reports: aligned totals, useful filters and purchase materials

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/report-filters-totals-20261020`
Current PR: pending
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
Prepare aligned full-result additive column totals, visible period controls and useful scoped filters, purchase material/category/supplier views through the existing bounded caller-RLS source. Material line values use recorded line returns, explicitly before invoice-level discount/tax. Current balance reports remain as-of/current, not falsely period-filtered.
## Verification ledger
Pending focused behavior/type/lint/build checks and isolated SQL caller-RLS proof. No production probes for this candidate.
## Production gate
No Merge ولا Production migration until reviewed exact-head required checks and explicit owner release approval. Candidate migration is UNAPPLIED.
## Next action
Implement and inspect reporting behavior, then prepare a concrete PR with findings and verification.
## Mandatory update protocol
Record failures and limitations honestly. Update this log/PR body before release. Do not weaken required gates or sum mixed units/prices/balances as if additive.
