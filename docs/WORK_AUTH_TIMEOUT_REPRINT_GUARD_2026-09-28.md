# Work Authorization Timeout + Receipt Reprint Guard — 2026-09-28

State: **IN_PROGRESS**

## Scope
- Work authorization request stays actionable for 60 seconds only.
- During the minute the employee gate uses Realtime; no polling.
- After timeout the gate enters sleeping state, removes Realtime, and needs a new explicit request.
- Stale requests are hidden from the manager queue and cannot be approved.
- Users with `pos.reprint` keep direct receipt reprint without manager approval.
- Users without `pos.reprint` get one completed-receipt print; the button becomes disabled after the first accepted print/queue.
- Print Agent executable, printer routing, KDS, kitchen printing and the frozen completion RPC remain untouched.

## Base
- main: `36fe875a3b14be17f908bb2d3015378922d0e50e`
- branch: `development/work-auth-timeout-reprint-guard-20260928`
- PR: `#400`

## Evidence
- Production showed work-authorization waits beyond one minute.
- Direct reprint jobs reached the queue with no approval id and later failed `INVALID_APPROVAL`.
- Print Agent startup delay is treated as startup behavior and is outside this code change.

## Change ledger
- Added one-minute request TTL and server-side stale-request rejection.
- Added sleeping gate state that removes Realtime after timeout.
- Added direct `pos.reprint` queue token without changing frozen agent completion RPC.
- Added completed-receipt print-once UI locks for non-reprinters.

## Verification
- Fast Verify: pending.
- Full Verify: pending.
- Production migration: not applied.
- Merge: blocked pending exact-head Green and final approval.
