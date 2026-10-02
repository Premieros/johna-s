# POS FINANCIAL SAFETY HARDENING — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/pos-financial-safety-hardening-20261002`
Current PR: `#0`
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
Planned code-only containment:
- Add synchronous in-hook financial mutation mutexes before the first await in both direct and linked/offline checkout paths.
- Fix offline pendingCount to reflect all unsynced stored rows rather than only currently eligible rows.

Planned server hardening, repository migration only until approved:
- Add nullable `sales.client_operation_key` plus a branch-scoped unique index.
- Add idempotent sale wrapper RPCs that take a stable client operation key, take a transaction-scoped advisory lock, return the already-created sale on retry, and delegate the first execution to the existing canonical normal/split sale RPCs.
- Keep existing RPCs available for compatibility; switch active POS/offline replay callers to the idempotent wrappers.
- Reuse one operation key across an ambiguous manual retry until success or the checkout context is intentionally reset.

## Verification ledger
- Production read-only integrity audit: complete.
- Existing main Verify/Deploy after PR #427: Green.
- Client mutex implementation: pending.
- Offline pending-count repair: pending.
- Server idempotency migration implementation: pending.
- Same-tick double-submit regression: pending.
- Same-key two-session server concurrency regression: pending.
- Lost-response/retry regression: pending.
- Offline retry/reconciliation regression: pending.
- Exact-head Full Verify: pending.
- Production migration: not applied.

## Production gate
State: **BLOCKED**
- No Production migration from this track has been applied.
- Production application of any idempotency migration requires exact SQL review, exact-head Full Verify Green, impact/rollback review, and a new explicit user approval.

## Next action
1. Add code-only client mutex and offline pending-count repair.
2. Add the server-idempotency migration and active caller wiring on this branch only.
3. Add concurrency/retry/offline regressions.
4. Open Draft PR and run exact-head Full Verify.
5. Present exact migration scope and verification evidence before any Production DB change.

## Mandatory update protocol
- Before every repository write, verify latest `main` and expected branch HEAD.
- Unexpected HEAD/divergence => **STOP_AND_RECONCILE**.
- Update this log after every material implementation, verification, PR, merge, or deployment event.
- Keep State **BLOCKED** until exact-head Full Verify is Green and the relevant explicit approvals are obtained.
- Never force push.
