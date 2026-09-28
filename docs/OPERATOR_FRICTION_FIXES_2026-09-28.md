# Operator Friction Fixes — 2026-09-28

State: **IN_PROGRESS**

Base main: `36fe875a3b14be17f908bb2d3015378922d0e50e`
Branch: `development/operator-friction-fixes-20260928`
PR: `#399`

## User-approved scope
1. Work-authorization request waits at most **60 seconds**.
   - While pending: Realtime wake-up only; no polling.
   - At 60 seconds without approval: stop Realtime subscription and enter a dormant local state.
   - User must explicitly send a new request.
   - Dormant state must not issue periodic database queries.
2. Receipt printing:
   - `pos.receipt.print` = first receipt print only.
   - After the first accepted/recorded print, ordinary users must not be able to trigger another receipt print from the UI.
   - `pos.reprint` keeps direct reprint capability without manager approval.
   - Super Admin implicit bypass remains intact.
3. Fix the cloud completion mismatch where a requester with `pos.reprint` can enqueue an authorized reprint but the Print Agent completion path incorrectly rejects it as `INVALID_APPROVAL`.
4. Do **not** change Print Agent startup, claim cadence, printer routing, KDS, kitchen send, ticket payload or station mapping.

## Safety
- Permission-first.
- No role-name authorization except existing Super Admin implicit bypass.
- No direct main writes.
- No Production migration before exact-head Full Verify Green + explicit Production approval.
- Printing agent/routing remains frozen.
- Single writer only.

## Findings before implementation
- Production showed receipt reprint jobs for authorized management users reaching the queue then failing at completion with `INVALID_APPROVAL`.
- Root cause: enqueue/authorization checks `pos.reprint` for the requester, while `complete_cloud_print_job` unconditionally requires an approval row for every print number > 1.
- Work-authorization gate currently uses Realtime with no polling, but a pending request has no expiry and the subscription stays alive indefinitely.
- Current backend keeps one pending request forever until decided/revoked.

## Planned implementation
- Add backend 60-second expiry semantics for pending work-authorization requests.
- Make stale pending rows explicit `expired` history, hide them from active pending snapshot, reject late approval, and permit a fresh request.
- Gate uses one local timeout to enter dormant state and unsubscribes from Realtime; no polling.
- Cloud print completion checks the original requester capability snapshot from current user/role permissions before requiring an approval.
- Sales invoice receipt action disables for one-time-print users when an authoritative sale print event already exists.
- POS receipt modal locally locks the one-time print action after the first accepted queue attempt; users with `pos.reprint` remain able to reprint.

## Change ledger
- Added `20260928080500_operator_friction_fixes.sql` for 60-second authorization expiry and requester-aware `pos.reprint` completion.
- WorkAuthorization gate: one local 60-second timeout, Realtime only while pending, unsubscribe + dormant state after expiry, explicit new-request action.
- Sales invoice print action: authoritative `sale_print_events` guard plus local immediate lock for one-time-print users.
- POS print action: separate `canReprint`, local one-time receipt lock, stable one-time open-check idempotency key; manager/direct-reprint users remain unrestricted.
- Print Agent binaries/protocol/startup/routing/KDS/kitchen payloads untouched.
- Regression tests added for expiry, direct manager reprint completion, and UI duplicate-print prevention.

## Verification ledger
- Pending.

## Production gate
- Exact-head Fast Verify: **NO — pending**
- Exact-head Full Verify: **NO — pending**
- Production migration approval: **NO**
- Production migration applied: **NO**
- Merge approval: **NO**

## Next action
Implement backend expiry + requester-aware reprint completion + UI guards, then run targeted tests and exact-head verification.
