# Shift Expected Cash Repair — 2026-09-27

## Work status

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/fix-shift-expected-cash-20260927`
Current PR: `#393`
Last updated: 2026-09-27
State: **BLOCKED**

Implementation exists on the development branch. Merge and Production migration remain blocked until exact-head Full Verify is Green and the protected-step requirements are satisfied.

## Guardrails

- Single writer; sequential repository writes only.
- Before every write, branch HEAD must equal the expected prior HEAD; unexpected HEAD => STOP_AND_RECONCILE.
- No direct writes to `main`.
- No force push.
- Printing, Print Agent, printer routing, thermal payloads and `cloud_print_jobs` are frozen.
- KDS, `send_to_kitchen` and Kitchen transport semantics are frozen.
- Order preservation and successor-shift behavior are frozen.
- Inventory deduction authority is frozen.
- Permission-First and RLS must not be weakened.
- No Production migration or data write from this branch before exact-head Full Verify Green and explicit approval.

## Baseline

Base main: `102dea0d2ebd0f7567217bfbad3c79ba6cdada81`.

Production Smouha incident at 2026-09-27 18:41 Cairo:

- shift: `3c8c3acb-8f65-4ce7-a5c6-13bcd7b1771c`;
- cash sales: 2,750.00 EGP;
- posted cash expenses: 2,420.00 EGP;
- in-window completed cash purchase: 315.00 EGP;
- canonical expected cash: 15.00 EGP;
- live `get_active_shift.expected` before close: 330.00 EGP;
- entered/stored actual cash: 330.00 EGP;
- stored difference: 315.00 EGP;
- nine open/held orders were preserved and a zero-opening successor shift was opened atomically.

The successor shift is currently internally consistent because it has no cash purchases yet.

## Root-cause ledger

1. `close_shift`, `close_shift_with_open_orders`, shift report and canonical close logic use `public._compute_shift_expected_cash(shift_id)`.
2. That helper subtracts posted branch-cash expenses and in-window cash purchases.
3. `get_active_shift` separately rebuilt expected cash from `shift_operations` only.
4. Cash purchases are not represented as shift-operation cash-out rows.
5. Therefore live expected cash omitted purchases and overstated the drawer by exactly the cash-purchase amount.
6. `ShiftsPage.openCloseModal` then copied that live expected amount into `actual_amount`, making the UI treat a calculated expectation as a physical cash count.
7. The close RPC still recomputed the canonical amount, so the persisted difference exposed the mismatch only after close.

Separate observation:
- one Smouha user session returned `session_not_found` immediately after the close and recreated a session about eight seconds later;
- no work-authorization revoke occurred at that moment;
- no evidence currently links session deletion to the shift-close RPC;
- this is tracked as a separate Auth/session-refresh investigation and is not modified in this repair.

## Change ledger

- Added `supabase/migrations/20260927212500_get_active_shift_canonical_expected_cash.sql`.
  - drift-guarded patch changes only `get_active_shift` expected-cash calculation;
  - expected cash now calls `public._compute_shift_expected_cash(v_shift.id)`;
  - informational `cash_sales`, `cash_in`, `cash_out`, and `total_sales` payload fields remain unchanged.
- Updated `tests/integration/shift_live_expected_consistency.test.ts`.
  - adds an in-window cash purchase with partial return;
  - asserts live expected cash and close expected cash both equal 180.00;
  - preserves existing drawer component assertions.
- Updated `src/features/trade/pages/ShiftsPage.tsx`.
  - Actual Cash starts blank instead of copying Expected Cash;
  - normal close and close-with-open-orders reject a blank/non-finite counted amount;
  - close buttons remain disabled while counted cash is blank.
- Added `tests/unit/shiftCloseCountedCashContract.test.ts`.
- No frozen print/KDS/order/inventory/permission/RLS paths changed.

## Verification ledger

- Production diagnosis: read-only and complete.
- PR #393: Draft.
- Exact-head Full Verify: pending.
- Fast Verify run #1036 / `36340558277`:
  - canonical migrations applied successfully on Fresh DB;
  - schema verification succeeded;
  - first changed-integration attempt failed only because the test purchase timestamp was two minutes before the fixture shift opening timestamp, so the canonical helper correctly excluded it;
  - no migration/application failure occurred.
- Test-fixture correction commit sets the test shift `opened_at` one hour earlier so the cash purchase is unambiguously inside the shift window.
- Fresh exact-head Fast/Full Verify after the fixture correction: pending.
- Unit counted-cash contract: pending final run.
- Production change from this branch: none.

## Production gate

- Exact-head Full Verify Green: **NO — pending**.
- Explicit Production migration approval for this branch: **NO**.
- Production migration applied: **NO**.
- Merge authorization: **NO**.
- State remains **BLOCKED**.

## Next action

1. Point the unified mandatory execution gate to this branch/log/PR.
2. Run exact-head Fast/Full Verify.
3. Confirm migration passes Fresh DB and the updated live-vs-close integration regression.
4. Re-check changed-file scope for frozen paths.
5. Stop before merge/Production migration and report readiness.

## Mandatory update protocol

- Update this log after every code/data-shape change, workflow result, or protected-step decision.
- Keep `State: **BLOCKED**` until Production gate requirements are satisfied.
- Record exact branch HEAD and workflow run before any merge decision.
- Any unexpected HEAD or unrelated write stops execution for reconciliation.
- Production is not a test environment.
