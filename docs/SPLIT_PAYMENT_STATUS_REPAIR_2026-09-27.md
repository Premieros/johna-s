# Split Payment Order Status Repair — 2026-09-27

## Work status

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/fix-split-payment-status-20260927`
Current PR: `#392`
Last updated: 2026-09-27
State: **BLOCKED**

Blocked means: implementation exists on the development branch, but merge and Production migration remain blocked until exact-head Full Verify is Green and the user explicitly approves the next protected step.

## Guardrails

- Single writer; sequential GitHub writes only.
- Before every write, branch HEAD must equal the expected prior HEAD; unexpected HEAD => STOP_AND_RECONCILE.
- No direct writes to `main`.
- No force push.
- Permission-First and RLS must not be weakened.
- Printing, Print Agent, `cloud_print_jobs`, printer routing and thermal payloads are frozen.
- KDS, `send_to_kitchen` and Kitchen transport semantics are frozen.
- Inventory deduction authority remains unchanged.
- No Production migration or Production data write before exact-head Full Verify Green + explicit approval.

## Baseline

Base main: `8268820185bcee05cf25535a570b5fd6a8ee18f3`.

Production read-only diagnosis found:

- cash: 87 linked completed sales in the last-24h sample, all linked orders `paid`;
- card: 41 linked completed sales, all linked orders `paid`;
- credit: 3 sales with zero paid amount, linked orders correctly `unpaid`;
- split: 5 fully paid linked sales totaling 10,749.00, all linked orders incorrectly remained `unpaid`.

Affected split sales had correct `sale_payments`, correct `paid_amount = total`, and correctly linked `order_kitchen_inventory_events.settled_sale_id`.

## Root-cause ledger

1. Normal `process_sale` performs linked-order payment-state reconciliation after Kitchen settlement finalization.
2. `process_sale_split` delegates the physical sale/inventory write to `_process_sale_core`, finalizes Kitchen settlement, writes split tender metadata, and rewrites collection accounting.
3. The split wrapper omitted the final linked-order `payment_status` reconciliation.
4. Therefore sale/tender/accounting truth was correct while `orders.payment_status` retained its pre-payment `unpaid` value.
5. Existing split atomicity coverage verified tender rows and inventory exactly-once behavior, but did not assert the linked order's final `payment_status`.

## Change ledger

- Added `supabase/migrations/20260927203000_fix_split_order_payment_status.sql`.
  - Dynamically patches only the current `process_sale_split` body using a drift-guarded marker replacement.
  - Recomputes linked-order paid/total from authoritative settled sale IDs after the split sale has its final paid amount.
  - Sets `paid` only when the order is completed and settled totals are covered.
  - Sets `partial` when payment exists but the linked order remains operationally incomplete.
  - Leaves no-payment state as `unpaid`.
  - Adds deterministic historical reconciliation for split-linked orders using de-duplicated settled sale IDs.
- Updated `tests/integration/split_payment_atomicity.test.ts`.
  - The Kitchen-sent linked split-payment case must end `status='completed'`, `payment_status='paid'`, with non-null `payment_at`.
  - Existing assertion that settlement does not deduct inventory twice remains.
- Updated `docs/CURRENT_WORK_PLAN.md`.
- Added this mandatory work log.
- No print/KDS/send-to-kitchen/inventory-authority/RLS changes.

## Verification ledger

- Production diagnosis: read-only, completed.
- Branch scope compare: 4 changed files before active-log correction; no frozen print/KDS files changed.
- PR: `#392` Draft.
- Verify run `#3126` / run `36339115294`:
  - failed at mandatory active work-log gate before lint/typecheck/tests;
  - exact reason: active gate still pointed to the previously completed zero-cost branch;
  - code/migration tests did not run in that attempt.
- Active work-log gate correction is documentation-only; a fresh exact-head verify is required after this update.

## Production gate

- Exact-head Full Verify Green: **NO — pending rerun after work-log correction**.
- Explicit Production migration approval: **NO**.
- Production migration applied: **NO**.
- Production data repair applied: **NO**.
- Merge authorization: **NO**.
- State remains **BLOCKED**.

## Next action

1. Point the unified mandatory execution gate to this branch/log/PR.
2. Run a fresh exact-head Full Verify.
3. If Green, re-check branch HEAD and `main` drift.
4. Stop before merge/Production migration and report readiness for explicit approval.

## Mandatory update protocol

- Update this log after every code/data-shape change, workflow result, or protected-step decision.
- Keep `State: **BLOCKED**` until every Production gate requirement is satisfied.
- Record exact branch HEAD and workflow run before any merge decision.
- Any unexpected HEAD or unrelated write stops execution for reconciliation.
- Production is not a test environment; no trial migrations or direct data fixes.
