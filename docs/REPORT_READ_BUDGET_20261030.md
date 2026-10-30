# Report read budget — 2026-10-30
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/report-read-budget-20261030`
Current PR: #551
Last updated: 2026-10-30
State: **BLOCKED**

## Work status
Owner approved software-only containment on the current plan. Implementation complete; local checks passed. Required CI and publication pending.

## Guardrails
No upgrade, production business writes, SQL migration, permission changes, sale/stock/printing changes, polling or timeout increases. Preserve #550 safeguards. No blanket index creation or index removal.

## Baseline
Main 4b6da2cae7e6d5c379fd80d9cedd8f0bb8be8cde; tree fdf62cf5f3a14a24a8680f80946685ccda3bf187.

## Root-cause ledger
Existing cache shares identical reads but permits unrelated expensive reports concurrently and continues queued abandoned work. Current historical-sale-cost monthly RPC still times out; this browser containment does not repair its SQL plan. Cumulative database counters do not establish present CPU attribution. Current resource observation is insufficient to attribute server load to a specific operational call.

## Change ledger
Serialize allowlisted read-only report network requests until response body drains. Cache hits and shared reads stay immediate. Skip queued requests with no consumers; never abort a dispatched shared read. Operational traffic bypasses queue. Wire costing overview/order read cancellation to scope changes and unmount. Existing cache keys, mutation invalidation and authoritative data sources remain intact.

## Verification ledger
43 focused behavioral/contract tests passed across report transport, costing lifecycle and worklog gates. Application + test TypeScript checks passed. Focused ESLint and diff whitespace checks passed. No production load probes or business writes. Initial CI passed 1168 database and 136 browser tests; one frontend assertion expected the former two-argument RPC call. Update the assertion for optional cancellation and verify all four costing methods forward the signal. Required exact-head CI remains pending; final release evidence will be recorded in the PR ledger.

## Production gate
No merge until focused checks and required exact-head CI pass. No database migration required. Rollback is a frontend commit revert; no business data rollback.

## Next action
Publish the locally verified candidate and run required CI once. Continue historical-cost SQL optimization separately without repeated heavy production probes.

## Mandatory update protocol
Update this ledger after substantive changes, checks and release. السجل هو المرجع الإجباري للعمل. CI يجب أن يفشل if this active ledger is missing. لا Merge ولا Production migration before required checks pass.
