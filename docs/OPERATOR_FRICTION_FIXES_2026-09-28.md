# Operator Friction Fixes — 2026-09-28

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/operator-friction-fixes-20260928`
Current PR: `#399`
Last updated: 2026-09-28
State: **BLOCKED**

## Work status
Implementation is complete on the development branch. Verification is in progress. Merge and Production migration remain blocked until exact-head Fast Verify and Full Verify are Green and explicit Production approval is recorded.

## Guardrails
- Permission-first.
- Super Admin implicit bypass only.
- No direct writes to `main`.
- No Production migration before exact-head Full Verify Green + explicit Production approval.
- Print Agent binaries/protocol/startup/routing/station mapping remain frozen.
- KDS, send-to-kitchen, kitchen payloads and printer routing remain untouched.
- Single writer only.
- Unexpected HEAD => STOP_AND_RECONCILE.

## Baseline
- Base main: `36fe875a3b14be17f908bb2d3015378922d0e50e`.
- Work authorization currently uses Realtime with no polling, but pending requests had no expiry and could remain pending indefinitely.
- Receipt enqueue authorization already respected `pos.reprint`, but `complete_cloud_print_job` required a manager approval row for every print number > 1, causing authorized management reprints to fail with `INVALID_APPROVAL`.
- One-time users could repeatedly trigger receipt/open-check print actions from the UI.

## Root-cause ledger
1. **Work authorization wait**
   - Pending request had no 60-second expiry.
   - Realtime subscription remained alive indefinitely while the request stayed pending.
2. **Manager/direct reprint**
   - Enqueue path: requester with `pos.reprint` could authorize reprint directly.
   - Completion path: every reprint required an approval row regardless of requester permission.
   - Result: cloud job could reach the agent and then fail as `INVALID_APPROVAL`.
3. **Duplicate employee print actions**
   - Sale page did not use authoritative `sale_print_events` to disable one-time print actions.
   - POS receipt modal did not locally lock after the first accepted print action.
   - Open-check idempotency key used `Date.now()`, so rapid repeated clicks created distinct jobs.

## Change ledger
- Added `supabase/migrations/20260928080500_operator_friction_fixes.sql`.
- Added 60-second work-authorization expiry semantics.
- Late manager approval after 60 seconds returns `REQUEST_EXPIRED`.
- Expired requests are omitted from the active pending snapshot; a fresh request is required.
- Employee gate uses one local 60-second timer, Realtime only while pending, then unsubscribes and enters dormant state with no polling.
- Added `expired` to the work-authorization status/history contract and UI history label.
- Cloud print completion now checks whether the original requester currently owns `pos.reprint` (or is Super Admin) before requiring an approval row.
- Sales invoice page loads `sale_print_events(id)` in the existing sales query and disables the one-time print button after a recorded print; managers with `pos.reprint` retain reprint.
- POS exposes `canReprint` separately.
- POS receipt action locally locks for one-time users after first accepted print action.
- Open-check printing uses a stable `open-check:<orderId>:one-time` idempotency key for one-time users and local lock state; direct-reprint users retain repeat printing.
- Print Agent code, startup, polling/claim cadence, station routing, KDS and kitchen send were not changed.
- Added regression tests for one-minute expiry, direct manager cloud reprint completion, and one-time UI print locking.

## Verification ledger
- Full Verify #3174: **FAILED only at mandatory active worklog structure** before code checks; no functional test failure was reached.
- Fast Verify #1131: running on prior exact code/docs head when this log correction was prepared.
- Exact-head verification for this documentation correction: pending.

## Production gate
- Exact-head Fast Verify: **NO — pending**
- Exact-head Full Verify: **NO — pending**
- Production migration approval: **NO**
- Production migration applied: **NO**
- Merge approval: **NO**
- State remains **BLOCKED**.

## Next action
Run exact-head Fast Verify and Full Verify. If any functional failure appears, fix only the failing scope and rerun. Stop before merge or Production migration and report readiness.

## Mandatory update protocol
- Before every repository write, re-read branch HEAD and require it to match the expected prior checkpoint.
- After every implementation group, update the Change ledger.
- After every test/measurement, update the Verification ledger.
- No merge or Production migration until exact-head Full Verify is Green and explicit approval is recorded.
- Do not use conversation memory as Source of Truth; this file and `docs/CURRENT_WORK_PLAN.md` are authoritative.
