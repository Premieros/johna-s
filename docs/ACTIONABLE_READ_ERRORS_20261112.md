# Actionable errors and historical costing read repair
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/actionable-read-errors-20261112`
Current PR: `628`
Last updated: 2026-11-12
State: **READY**

## Work status
Owner requests understandable actionable errors, hidden technical internals, and repair of the underlying failures.

## Guardrails
Keep all RLS/visibility and invoker security, canonical prices, results and writer/print contracts. No production business tests, role grants, timeout increases or polling. Owned rollback-only database tests.

## Baseline
Released permission repair PR627 at69e495ca7e7298253bcfd832100fb0f38fe26978; main43189334972 and actual Pages43190070183 succeeded. Served index-5dgL6mgg.js contains that source, approval bell and permission hints, without removed print alert button.

## Root-cause ledger
Production postgres57014 at08:51 and08:58UTC identifies get_historical_sale_cost_estimates, not failed sales summary. Read-only authenticated EXPLAIN shows both zero-cost ledger scans constrained only by reference_type, performing financial visibility checks before selecting relevant invoice/event IDs despite existing reference index. UI mislabels historical-stage failure as sales-summary failure. Shared errors group timeout/lock/network and tell report readers to check an order.

## Change ledger
Implemented scoped indexed lookup fences. Keep root-reference visibility unchanged; inline the identical generic ledger visibility formula so history permission/configuration are statement InitPlans instead of per-row queries. Authenticated costing relies on enforced restrictive ledger RLS instead of repeating the ledger checks; sales checks stay explicit. Preserve the consumption report policy fingerprint and add a matching fail-closed ledger guard to historical costing; privileged invokers retain the original explicit checks. Public RPC remains invoker-secured, with unchanged ACL. Shared errors distinguish network, timeout and lock conflicts, hide permission codes and retain safe unknown-write guidance. Report reads get load-specific guidance; costing stage labels are accurate and rejected read promises release loading state. No new source of prices or balances.

## Verification ledger
Production inspection is read-only. Scoped-only candidate still exceeded3s and scoped-plus-duplicate-check reduction exceeded5s; do not claim those partial candidates solved the problem. Final candidate includes generic RLS context InitPlans.70 focused frontend checks passed (69 shared/report checks plus the added rejection regression);32 isolated DB checks passed, including predicate parity across3456 virtual reference/date/branch cases, foreign-branch and history restrictions, amount parity and exact rollback. Existing monthly2500-invoice /1000-ledger fixture passed after final policy optimization. Final application/test typechecks and focused lint passed. First full CI found an obsolete toast source assertion (2090 frontend checks passed) and the consumption report policy-fingerprint compatibility guard (1269 DB checks passed,6 related failures). Corrected both before production:39 targeted frontend checks passed; all44 targeted DB checks passed, including the consumption report and historical fail-closed guard. The8s monthly benchmark is sensitive to concurrent local CPU work and passed all3 checks when rerun serially; its budget and assertions were not relaxed. Full exact-head required checks remain mandatory. Release proof for permission repair recorded above.

## Production gate
Owner authorizes repair and deployment; apply only verified bounded function-body change. Do not weaken authorization or visibility, and do not raise timeout budgets.

## Next action
Complete final focused checks and exact-head CI, then apply the guarded read-only schema change, measure one authenticated month read, merge and verify actual Pages. Rollback is scripts/rollback/costing_historical_scoped_lookups_20261112.sql.

## Mandatory update protocol
Record exact tested head, CI, migration and actual publication; do not claim system-wide performance from an isolated read improvement.
