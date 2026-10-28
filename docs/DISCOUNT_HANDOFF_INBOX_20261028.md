# Permission-based discount handoff and approval inbox reliability
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/discount-handoff-inbox-20261028`
Current PR: #545
Last updated: 2026-10-28

## Work status
State: **BLOCKED**
Owner reported real manager-discount/cashier checkout and multi-reviewer inbox failures. Prepare one repair; no production apply or publication without separate release approval.

## Guardrails
Single writer, johnas only. No production invoice/order/test/print/log-scan writes, automatic financial retry, old print replay, grant changes to business roles, new SECURITY DEFINER function, recipe/stock/discount equation, transfer identity or Windows agent changes. Four speculative edge cases from the prior audit remain deferred per owner. System is online-primary; local state is UX assistance, not financial authority.

## Baseline
Main808c534ca0ff63f6641a4a3c73e4dda40a54317b, tree37405283b06a1b66fff12bd155db66f4c90e8533 (#544). Preserve all previous receipt, shared-shift, captain-at-close, idempotency and queue repairs.

## Root-cause ledger
Both checkout wrappers demand a requester-specific discount approval from a cashier even if another user already authorized/saved the order discount. The invoice insert guard also only accepts that cashier-owned consumed approval. A saved numeric order discount alone is insufficient proof: users with edit access can modify order fields, so blindly trusting every saved amount would weaken authorization.
Live Cleopatra manager:discount policy is permission-based (approvals.review), not assigned to one user. Multiple active branch reviewers have that capability and branch access; approval_requests is in Realtime publication and RLS permits qualified reviewers. The inbox loads before subscribing but reconciles only on later reconnect, so the initial subscription gap can miss a pending request. It also has no failed-subscription fallback/focus refresh and discards decision failures. The exact browser event history of the reported omission is not available; tests reproduce the code-level gap, not a named user's network history.

## Change ledger
Private, non-API authorization cache keyed by exact order: frozen discount budget/type, branch and author. Only the existing server mutation guard captures a write by a user with pos.discount. No cashier receives that permission. Existing normal/split checkout can use exact matching saved proof; payment bookkeeping is scoped for both own and other-operator orders so collecting does not require general order-edit authority; split also compares authoritative pending preview. A transaction-scoped invoice/branch/amount/subtotal envelope is validated by the existing invoice guard under the existing privileged checkout boundary, restored immediately after the sale core, and logged with both collecting user and discount author. Authenticated direct inserts and caller-forged context cannot use the private proof. Cashier-owned approved requests retain their existing path.
Existing unproven legacy discounts are NOT backfilled or automatically approved. A qualified user can reconfirm the same monetary value using the existing discount UI; an explicit unchanged-value confirmation is now persisted. Proof stops matching if the budget/type changes without authorization. Partial-transfer algorithms and financial formulas remain unchanged; an altered/reallocated budget may require reauthorization rather than inheriting unproven authority.
Inbox: reconcile after initial subscription; independently read the shared pending queue for every authorized reviewer; refresh on focus/open, and every30s ONLY while Realtime is unavailable and tab visible. No healthy-connection periodic polling or new print reads. Surface decision errors; one authorized decision resolves the shared request for all reviewers, not a requirement that every reviewer approve.

## Verification ledger
Focused frontend component/hook tests exercise subscription gap, independent reviewers, disconnected-only recovery, permission gating, decision rejection and same-value confirmation. App/test types and API contract checks required. Isolated DB integration tests cover normal/split cashier settlement, author without collection permission, capability under non-manager role, refusal without capability, legacy/mutated budget refusal, failed-payment rollback, forged proof/context refusal and rollback/reapply exact-body/metadata parity. Mandatory exact-head full Verify main pending.

## Production gate
لا Merge ولا Production migration before exact-head all-four successful CI and explicit owner release approval. New private table/helper have RLS and no PUBLIC/anon/authenticated access; helper is SECURITY INVOKER. Existing function security/owner/search_path/ACL remain unchanged. No production changes performed during preparation. Do not automatically bless historic order discounts.

## Next action
Run exact-head full verification, inspect only actual failures, then present one reviewable candidate and legacy confirmation caveat for final approval.

## Mandatory update protocol
السجل هو المرجع الإجباري للعمل. CI يجب أن يفشل if active log/branch is invalid. Update PR number before final exact-head verification. Record full results/release evidence in the PR ledger to avoid docs-only reruns. Guarded rollback: scripts/rollback/discount_handoff_authority_20261028.sql, restoring the four function bodies then removing only the new private authorization cache/helper; invoice/audit history remains. Revert the frontend PR as needed.
