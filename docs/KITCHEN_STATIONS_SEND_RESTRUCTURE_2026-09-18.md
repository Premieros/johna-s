# Kitchen Stations + Send Button Restructure — 2026-09-18

## Scope
- Base: `main@50789b393f3708e03fe2e732cf7df618e25a0e4c`
- Branch: `development/kitchen-stations-send-button-restructure`
- No Production DB migration in this change.
- No RLS or permission weakening.
- Inventory deduction remains owned by authoritative `send_to_kitchen`.

## Changes
1. Added `kitchenDispatch.ts` as the single station-dispatch orchestrator.
2. `sendOrderToKitchen` now owns only authoritative kitchen send + delegates station dispatch.
3. Dispatch returns per-station state:
   - `queued`
   - `local_printed`
   - `failed`
4. Dispatch summary reports `complete / partial / failed / not_needed`, failed station codes, and items missing a station.
5. POS send button/header now surfaces partial station failure and names failed stations instead of showing only generic success.
6. Button wording distinguishes first send, new deltas, and already-sent state.
7. Kitchen Stations page now shows branch-level readiness summary and per-station configuration health.
8. Added regression/contract coverage in `tests/unit/kitchenStationsSendRestructureContract.test.ts`.

## Verification
Pending GitHub CI at time of this log entry.
