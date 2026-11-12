# Permission path repair
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/permission-paths-20261112`
Current PR: `627`
Last updated: 2026-11-12
State: **READY**

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
141 focused frontend checks passed in32 files, including the inactive-role regression and disabled human-action no-callback checks.25 DB checks passed across dedicated receiving actual partial receipt, denial/branch isolation, existing receipt atomicity/procurement flow and unchanged frozen v7/agent contracts. Typechecks, targeted lint, API contract and worklog checks passed. First candidate full DB and browser shard1 passed; frontend2085 passed with one outdated literal assertion for the send-button disabled expression. Updated that assertion and added real busy-click regressions. Full exact-head CI rerun remains required.

## Production gate
Owner authorizes repair, merge and application as necessary to complete it. Apply only the bounded authorization-guard migration after full CI, without executing business RPCs in production. Rollback can restore the prior guard; UI rollback is independent of print agents.

## Next action
Finish exact-head CI, apply the guarded authorization migration, verify definitions/ACLs without business writes, merge and observe actual Pages publication. No additional user confirmation is needed for the already requested repair.

## Mandatory update protocol
Record tested source, actual application/publication results and limitations. Keep the prior audit findings as baseline evidence, not an unimplemented final response.
