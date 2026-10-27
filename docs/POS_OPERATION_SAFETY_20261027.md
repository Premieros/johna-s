# POS operation safety repair
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/pos-operation-safety-20261027`
Current PR: #0
Last updated: 2026-10-27

## Work status
State: **BLOCKED**
Implementation authorized. Production release awaits exact-head checks and separate owner approval. السجل هو المرجع الإجباري للعمل.

## Guardrails
Single writer. No production operational writes, LogQuery/Logs Explorer scans, test orders, prints, replay, agent reinstall, new SECURITY DEFINER/RLS/grants or changes to financial/stock/queue equations. Keep the installed Windows agent and atomic handoff gate unchanged. Never alter captain counts to match an unproven expected number.

## Baseline
Main 77cdfea6d1edcd5f9c29aa56276f2cd42c891f53; local base tree 621e3b03d4e4cf6fdc31cd1d3faa3e380570efc2. #543 receipt metadata repair remains preserved.

## Root-cause ledger
1. Failed resume retained another order's cart under the requested new ID.
2. Initial kitchen send guarded by React state, permitting same-tick duplicate order creation before server per-order dedup.
3. Failed hold acquired a synchronous mutex without releasing it; direct sale checked it without acquiring it.
4. Module-global split tender expired after 15 seconds and silently became ordinary cash.
5. A completed old payment could reset a newly selected workspace after its network response arrived.
6. Retrying an ambiguous linked settlement refreshed a completed order preview before reaching durable server idempotency recovery.
7. Both checkout wrappers captured captain before their later order lock.
8. Split checkout lacked normal checkout's unconditional explicit-shift guard; neither wrapper held that shift open through commit.
The Ali29/28 / missing-four complaint remains unproven in real data: five incident shifts and82 incident-day sales had no detected mismatch. These code fixes are not claimed to explain it.

## Change ledger
Clear stale resume cart and metadata; hydrate persisted customer/discount with the requested order. Share a synchronous mutex across hold/send/direct/linked checkout and release in finally. Fence async workspace effects. Send immutable split tenders directly as an explicit argument, without global state or TTL. Cache the exact pending request, tender and receipt snapshot only for ambiguous response recovery; manual retry reuses the same server idempotency key, invoice and full payload without another number/preview. Explicit rejection clears that snapshot. Payment results cannot clear a different order/cart. Navigation actions refuse while a write is in progress; no background retry.
Migration changes only public.process_sale and public.process_sale_split bodies: acquire an existing explicit shift row FOR SHARE before financial work, and capture the saved order captain with FOR UPDATE before preparation. Existing owner/ACL/search_path/security mode/signatures remain unchanged. Normal path adds no new query; split adds one indexed primary-key check. No table scans, new polling, N+1 query or new report source.
Frontend audit logging is nonblocking after confirmed direct sale; it cannot strand a paid cart. Paper routing, exact transfer identities and receipt queue idempotency are untouched.

## Verification ledger
44 focused frontend tests passed locally in six files, including the six new reproduction/regression cases; app/test TypeScript passed. Integration proof includes closed/foreign explicit shifts for cashier/manager/owner, two-session shift closure serialization, concurrent captain change at settlement, existing idempotency/split atomicity tests and exact guarded rollback/reapply metadata equality. Required isolated CI pending; CI يجب أن يفشل on invalid active-worklog binding.

## Production gate
لا Merge ولا Production migration before separate approval. Apply only to azzdesuowpdcoflmyezn after fresh definition/security preflight. Current production preimage hashes: process_sale 03a148288dcf37f250e7a49f5afc0cd4; process_sale_split 6d372a7806ef0f698b95b8184287a35a. Expected candidates: 41c3c30c2e784ca50a16f80c96873dce and44d7ea964b37141aeb4e7a91364ad017 respectively. Existing SECURITY DEFINER properties are retained, not introduced or broadened.

## Next action
Complete exact-head Verify main (all four required jobs), inspect failures only if present, then present one candidate for production approval. No physical print proof is claimed.

## Mandatory update protocol
Keep this source worklog and the PR verification/release ledger current. Bind PR number before final exact-head CI. Avoid docs-only test reruns after recording final results in PR metadata. Rollback SQL: scripts/rollback/pos_checkout_concurrency_safety_20261027.sql; restore only the guarded function fragments and revert the frontend PR. No operational data reversal.
