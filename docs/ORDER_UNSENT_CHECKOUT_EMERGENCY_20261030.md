# Emergency check lifecycle containment
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `hotfix/order-unsent-checkout-20261030`
Current PR: #550
Last updated: 2026-10-30

## Work status
State: **BLOCKED**

## Guardrails
Owner identifies Smouha05775 and requests emergency repair, then clarifies payment/printing must reject any unsent item. No authority to guess whether an extra served unit was intentional; preserve all original sales and inventory.

## Baseline
Main5fbddf977955e569b71db283e07a5f9f47487f40.

## Root-cause ledger
Evidence:05775 has a completed20 sale for2 waters, an older3-unit event voided1, and a later1-unit kitchen event. Its current authoritative preview offers10 for that1 unit. Earlier telemetry proves NO_SENT_ITEMS_TO_SETTLE then PAID_ITEM_REFUND_REQUIRED; this is not evidence that paid quantities may be Voided. Other referenced orders05654/05776 are completed/paid in the server despite stale workspace attempts. No production writes during diagnosis. #549 changed only costing summary/index, not order lifecycle.

Root findings: frontend explicitly permits sent-only checkout with an unsent warning; this violates the owner's current rule. Realtime rejoin does not reload missed terminal events. Order payload hydration can race terminal completion after access approval. A rejected terminal checkout leaves the old workspace available.

## Change ledger
Repair: reject unsent quantities in shared normal/split settlement preparation under the order lock and open-check enqueue before job insertion; acquire the same order lock for print enqueue. UI blocks payment and print using existing preview, clears only the unchanged terminal workspace, rejects terminal hydration race, and refreshes the existing branch snapshot once after Realtime reconnect without polling or write replay. No new RPC/signature/ACL/RLS or calculation source.

## Verification ledger
Verification: focused behavioral unit tests and native cash/split/print rejection with no sale/job creation; historical paid-open reconciliation remains covered using an explicitly reconstructed legacy fixture. Full exact-head CI pending. Guarded inverse restores original function definitions. Do not claim that unit3 was accidental or that05775 was repaired by charging/cancelling it.

## Production gate
لا Merge ولا Production migration before exact-head tests pass and live function fingerprints match. Owner requests emergency repair; no approval to invent a financial reversal.

## Next action
Next: finish tests, review exact diff/security/rollback, publish candidate, apply only tested guarded SQL on johnas and verify read-only status. Production operations are never test fixtures.

## Mandatory update protocol
السجل هو المرجع الإجباري للعمل. CI يجب أن يفشل for branch/log divergence. Record release evidence in the PR ledger; no repeated healthy full test runs.
