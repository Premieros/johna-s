# POS FINANCIAL SAFETY HARDENING — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/pos-financial-safety-hardening-20261002`
Current PR: `#428`
Last updated: 2026-10-02

## Work status
State: **BLOCKED**

## Guardrails
- No direct write to `main`.
- No force push.
- No Production migration or data write in this track without a new explicit approval after exact-head Full Verify Green.
- Production remains live for Cleopatra and Smouha; all investigation is read-only unless separately approved.
- Preserve Permission-First, branch isolation, RLS, accounting, FIFO, KDS routing, printing, payment attribution, shifts, and existing sent-only settlement behavior.
- `send_to_kitchen` behavior remains frozen unless a proven regression requires a separately reviewed fix.
- Client-side locking may reduce duplicate attempts, but the server must remain authoritative for financial idempotency.
- A lost/ambiguous network response must never cause a second financial write on retry.
- Offline queue ownership and branch+invoice reconciliation remain mandatory.

## Baseline
- Branch created from `main@746b0538b55de88173d0d070d9ff54ca8ea31f42`.
- PR #427 paid-order reopen protection is merged, deployed, and Production-verified.
- Post-merge Verify main and Deploy are Green.
- Production read-only audit on 2026-10-02 found:
  - duplicate branch/invoice groups: 0;
  - duplicate kitchen send rows: 0;
  - duplicate journal reference groups: 0;
  - unbalanced recent journals: 0;
  - split-payment mismatches: 0;
  - paid open empty shells: 0;
  - active duplicate-config order-item groups: 0;
  - table/order occupancy mismatches: 0;
  - settled sale-item vs kitchen-event quantity mismatches since 2026-09-30: 0;
  - kitchen send/event mismatches since 2026-09-30: 0;
  - no suspicious identical direct-sale pair within five seconds in the last 30 days.
- Six historical kitchen send/event quantity differences remain on completed Smouha orders dated 2026-09-17/19; no new occurrence since the later guards.

## Root-cause ledger
1. The UI disables payment while React state `completing` is true, but state updates are asynchronous; two same-tick calls can still pass the precondition before the render commits.
2. Online ambiguous failures intentionally do not enqueue an offline sale, which prevents automatic duplication, but a manual retry currently creates a new invoice/attempt identity.
3. Branch+invoice uniqueness protects retries that reuse the same invoice, especially offline reconciliation, but it cannot recognize the same logical online attempt if a retry receives a different invoice number.
4. Linked-order settlement has server row locking and kitchen settlement guards; direct unlinked sales have no durable logical-attempt idempotency key beyond invoice identity.
5. Offline sync currently sets `pendingCount = 0` when no row is eligible for the current automatic attempt, even if blocked/dead-letter/backoff rows remain stored.

## Change ledger
Implemented code-only containment:
- Added synchronous in-hook financial mutation mutexes before the first await in direct, linked-order, and explicit-offline checkout paths.
- Fixed offline pendingCount to reflect all unsynced stored rows, including deferred/blocked/dead-letter/backoff rows.
- Retained the same logical sale operation identity until the confirmed Sale has been reflected into local workspace/receipt state.

Implemented server hardening, repository migration only until approved:
- Added private table `private.pos_sale_idempotency` keyed by `(branch_id, operation_key)`; no direct client access.
- Added `process_sale_idempotent` and `process_sale_split_idempotent` wrappers using a transaction-scoped advisory lock, stable request hash, actor ownership check, and replay of the original response.
- Same operation key + different financial payload fails closed with `IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD`.
- Existing canonical `process_sale` / `process_sale_split` bodies remain unchanged for compatibility.
- Active POS, IndexedDB replay, and legacy offline replay now use the idempotent wrappers.
- Browser E2E verifies `p_client_operation_key` is sent on completed checkout.

## Verification ledger
- Production read-only integrity audit: complete.
- Existing main Verify/Deploy after PR #427: Green.
- Client mutex implementation: complete on branch.
- Offline pending-count repair: complete on branch.
- Server idempotency migration implementation: complete on branch; not applied to Production.
- Same-tick double-submit contract regression: Green.
- Same-key two-session server concurrency regression: Green; idempotency integration test 3/3 passed.
- Same-key replay after an ambiguous/lost response returns the original Sale/result: Green.
- Split-tender replay does not duplicate tenders or shift operations: Green.
- Offline replay contract uses stable operation keys: Green.
- Fresh DB migration/schema verification: Green.
- Integration + Security/RLS regressions: Green (165 files / 881 tests on the verified run after search_path fix).
- Browser Smoke: Green on exact head `6637a5425531bc6bb872eb6b0325d177b36453b5`.
- Exact-head Full Verify: Green on `6637a5425531bc6bb872eb6b0325d177b36453b5`; this documentation commit requires a fresh exact-head Verify before any Production gate can open.
- Production migration `pos_sale_idempotency_guard_20261002`: applied to Production with explicit user approval and verified read-only.

## Production gate
State: **BLOCKED**
- Production migration `pos_sale_idempotency_guard_20261002` was applied with explicit user approval after exact-head Full Verify Green.
- Post-apply verification: private ledger exists with RLS enabled; anon/authenticated have no direct table access; both wrappers use `search_path=public, pg_temp`; anon has no EXECUTE; authenticated/service_role have intended EXECUTE; internal checks for auth.uid, branch access, `pos.payment.take`, operation ownership, advisory lock, and payload mismatch are present.
- Post-apply financial integrity: duplicate branch/invoice groups 0; duplicate journal references 0; recent unbalanced journals 0; paid open empty shells 0; duplicate kitchen send rows 0.
- PR #428 merge/deploy remains BLOCKED until a fresh exact-head Full Verify is Green after this documentation update and explicit merge approval is obtained.
- Rollback before app deploy: drop the two wrapper RPCs and the private ledger table. Rollback after app deploy must restore the previous app release first, then remove the wrappers/table.

## Next action
1. Run fresh exact-head Full Verify after this documentation-only commit.
2. Re-check PR/head/main for parallel changes before any further write.
3. If exact-head Full Verify is Green, request explicit approval to mark PR #428 ready and merge/deploy.
4. Do not merge PR #428 without that explicit approval.

## Mandatory update protocol
- Before every repository write, verify latest `main` and expected branch HEAD.
- Unexpected HEAD/divergence => **STOP_AND_RECONCILE**.
- Update this log after every material implementation, verification, PR, merge, or deployment event.
- Keep State **BLOCKED** until exact-head Full Verify is Green and the relevant explicit approvals are obtained.
- Never force push.
