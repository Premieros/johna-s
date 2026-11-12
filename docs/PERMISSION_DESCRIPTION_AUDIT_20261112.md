# Permission descriptions versus enforcement audit
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `audit/permission-description-20261112`
Current PR: `0`
Last updated: 2026-11-12
State: **BLOCKED**

## Work status
Owner requests verification that permissions behave according to their descriptions. Audit UI access/actions, canonical capabilities, backend guards and branch isolation, prioritizing POS/order types, receipt/agent printing, approvals, finance, inventory and user administration.

## Guardrails
Read-only production catalog/configuration inspection. No live orders, payments, inventory movements, printing, role edits or permission grants. Run allow/deny mutations only in owned localhost fixtures with rollback. No deployment or production fixes in this audit request.

## Baseline
Main92c08d2 (same source tree as local4b851d0).122 canonical capabilities. Production role arrays contain no unknown/retired permission keys;15 configured roles are currently active. Super Admin is the documented platform exception; ordinary roles must resolve only their stored permissions.

## Root-cause ledger
Confirmed UI/backend mismatch: RolesProvider includes permissions of inactive role definitions; backend can_permission requires roles.is_active=true. Isolated behavioral reproduction shows payment-allowed on the UI for a disabled custom role, while the backend test denies the same capability. Production currently has no inactive role; this is latent, not evidence of a current unauthorized write.

Confirmed receiving mismatch: purchases.receiving is the screen/action guard in ReceivingPage and procurement.receive is labelled Receive Purchases, but live receive_purchase_order(uuid,jsonb) authorizes purchases.manage. In rollback-only fixtures, dedicated view/receiving/procurement.receive returns NOT_ALLOWED; purchases.manage alone passes authorization and reaches NOT_RECEIVABLE for the deliberately completed fixture. No receipt/stock mutation is attempted.

Accepted printing compatibility after owner clarification: can_execute_cloud_print_kind intentionally allows the shared agent to execute kitchen/receipt/report jobs when it has any existing print transport capability. Receipt-only local fixture can claim a kitchen job, and kitchen-only grants receipt/report transport execution. This must NOT be tightened: owner explicitly requires denial at human action buttons and no impact on installed print agents. Request creation/dispatch, user action buttons and branch checks remain distinct. Narrow-kind reproduction assertions are therefore outside the clarified requirement, not deployment blockers.

New UI presentation requirement: unauthorized user actions should be disabled rather than merely hidden. For example, the current POS header conditionally hides printing/payment/transfer actions. This requires scoped UI work, preserving handler/backend authorization and the agent compatibility contract.

## Change ledger
Audit log only. No application, SQL or production-data changes.

## Verification ledger
127 existing frontend/unit/component checks passed in28 files (~10.3s).246 existing isolated integration checks passed in28 files (~31.7s), covering permission-first drift, order types, sent-item void, branch/RLS isolation, print status, user/role management, financial read/action boundaries and work authorization.

Targeted audit probes: active-role UI control passes; inactive-role UI denial fails with payment-allowed. Backend inactive-role denial passes. Dedicated receiving probe fails with NOT_ALLOWED while broad purchases.manage reaches the expected non-receivable business-state check. Additional transport probes document the explicitly preserved shared-agent contract. Failing reproduction sources were moved outside normal test discovery into scratch evidence; no failing release candidate or application change was created.

Read-only production checks: all122 canonical keys recognised, no retired/unknown keys in15 active role arrays, no missing configured dependency closure, no matched ordinary operational get_user_role label gates in the sampled catalog scan. Some role labels have all122 capabilities by configuration; this is not a code bypass and must not be changed automatically. Super Admin remains the documented platform exception. This review does not prove every unexercised path universally correct.

## Production gate
No production mutation, migration, merge or publication is authorized or required by this verification-only task.

## Next action
Audit complete. Any follow-up must disable unauthorized human action buttons with clear explanations, retain backend protection, filter inactive role definitions in UI permission resolution, and align the receiving capability after reviewing existing purchase callers. Do not alter cloud print claim/start/complete, can_execute_cloud_print_kind, installed agents or frozen Smouha v7 contracts. No fixes or deployment were performed in this verification-only task.

## Mandatory update protocol
Record evidence and actual test counts. Preserve deployed print alert removal and organization signup; do not infer authorization from role names or conflate assigned full-access roles with a code defect.
