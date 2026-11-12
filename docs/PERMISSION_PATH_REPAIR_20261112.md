# Permission path repair
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/permission-paths-20261112`
Current PR: `627`
Last updated: 2026-11-12
State: **DEPLOYED**

## Work status
Owner explicitly requests fixing the audited permission paths. Disable unauthorized human action buttons and keep the shared printing agent completely unaffected.

## Guardrails
No cloud print RPC/worker/agent/routing changes. No production role grants, sample purchases, stock movements, payment or print operations. Backend permission and branch checks remain authoritative. Functional mutations run only on owned localhost fixtures with rollback.

## Baseline
Main92c08d2. Prior audit:127 frontend and246 integration checks passed, but confirmed inactive-role UI resolution and dedicated purchase receiving authorization mismatch. Shared print-agent transport permissions are intentional and excluded from repair.

## Root-cause ledger
RolesProvider exposes inactive-role permission arrays. Receiving UI uses a screen-view capability, while receive_purchase_order only recognizes broad purchases.manage. POS header hides permission-denied actions rather than disabling them.

## Change ledger
Implemented: filter inactive roles; recognize procurement.receive in receiving while preserving the existing purchases.manage umbrella for established callers; separate screen access from execution; disable unauthorized POS human actions in relevant order contexts. No changes to inventory/accounting implementation or printing.

## Verification ledger
141 focused frontend checks passed in32 files, including the inactive-role regression and disabled human-action no-callback checks.25 DB checks passed across dedicated receiving actual partial receipt, denial/branch isolation, existing receipt atomicity/procurement flow and unchanged frozen v7/agent contracts. Typechecks, targeted lint, API contract and worklog checks passed. First candidate full DB and browser shard1 passed; frontend2085 passed with one outdated literal assertion for the send-button disabled expression. Updated that assertion and added real busy-click regressions. Exact head03d6e8ef6745e835e229e1335f49b5ec710cee14 passed Verify43188531125:2088 frontend tests,1273 DB passed/1 skipped, both browser shards, browser-smoke and Pages continuity.

## Production gate
Owner authorizes repair, merge and application as necessary to complete it. Apply only the bounded authorization-guard migration after full CI, without executing business RPCs in production. Rollback can restore the prior guard; UI rollback is independent of print agents.

## Next action
Production migration20261112091133 applied; dedicated receiving guard enabled, anonymous execution remains denied. Protected print-function fingerprint before/after is f6f92f3431cc3130bb0ddd624b68a788 (unchanged). PR627 merged at69e495ca7e7298253bcfd832100fb0f38fe26978. Exact-main Verify43189334972 and actual Pages43190070183 succeeded. Served index-5dgL6mgg.js contains source69e495ca7e7298253bcfd832100fb0f38fe26978, approval-inbox-button and the permission explanation; system-alerts-button remains absent. No live business test writes or role grants.

## Mandatory update protocol
Record tested source, actual application/publication results and limitations. Keep the prior audit findings as baseline evidence, not an unimplemented final response.
