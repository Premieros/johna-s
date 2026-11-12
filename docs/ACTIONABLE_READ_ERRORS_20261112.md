# Actionable errors and historical costing read repair
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/actionable-read-errors-20261112`
Current PR: `628`
Last updated: 2026-11-12
State: **DEPLOYED**

## Work status
Owner requests understandable actionable errors, hidden technical internals, and repair of the underlying failures. Error handling and bounded costing reads are released in PR628. The environment interruption was resolved; the measured monthly branch-check follow-up is released in PR630 (see docs/BRANCH_READ_INITPLANS_20261112.md).

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
The formerly blocked continuation is released in PR630; see docs/BRANCH_READ_INITPLANS_20261112.md for final application/publication and both-branch measurements. There is no remaining environment blocker for this work. Preserve the fail-closed policy guards and execute the PR630 rollback before any PR628 rollback. Already-applied migrations must not be edited.

## Mandatory update protocol
Record exact tested head, CI, migration and actual publication; do not claim system-wide performance from an isolated read improvement.

## Release evidence and remaining limitation
PR628 merged at c6a36186f50a568cce6654a0320a7b3e7b7e419f (tree c7dd3c5b76ac77ce276d15e0ce987a9a00aea4e0). Exact tested head abec43be7f8eeaa6a269675703cecd3b5a745b72 passed full Verify43194467166:2091 frontend tests,1276 DB tests/1 skipped, both browser shards, smoke and Pages continuity. Exact-main Verify43196003395 and actual Pages43196629736 succeeded, including production-parity and deploy. Build artifact contains index-BlIuFKsG.js. Native served-module inspection was unavailable after the execution environment stopped; the public web tool cannot retrieve the JS asset. Publication is evidenced by the actual successful deployment, not an invented browser check.

Production migration20261112095212 (costing_historical_scoped_lookups; source20261112092131) applied. Both public consumption RPCs remain SECURITY INVOKER with unchanged postgres/service_role/authenticated execution ACL and no anon execution. Security advisor groups are unchanged. The protected print-function fingerprint, ordered by pg_proc.oid for this comparison, is5bf7d460c2c450eea250b8a66424eda8 before/after. No business rows, role grants or print operations were written.

The authenticated October2026 read for branch19c3fd23-d784-455b-8840-f4f2ac619651 still exceeded a5-second diagnostic cutoff. Verified authenticated/authenticator role configuration remains statement_timeout=8s; no system limit was raised. A single full RPC measurement within that existing8s budget succeeded in6351.63ms, with77753 shared hits and3 disk reads. This proves that sampled read completed, not that all load or all monthly timeouts are eliminated. Observed remaining hotspot includes repeated user_may_access_branch/is_pos_admin evaluation. Do not report the full performance task as complete. The owner was informed that further work is blocked by unavailable local execution, while the verified release is live.

## Resolved continuation — PR630
The unavailable-execution note above records the earlier interruption. After restoration, five read policies cache an already-existing zero-argument predicate per statement while retaining canonical branch checks for other callers. Production migration20261112111021 and Pages43208126835 succeeded at9fa35c99896d25adb9a4820bc8e49d6ed2d57518. Smouha October historical cost measured3.04s (previous6.35s), Cleopatra4.95s; both within unchanged8s. Shared print contracts, security/ACLs, prices and business data are preserved. This closes the observed blocked continuation, without claiming all possible queries or traffic levels were benchmarked.
