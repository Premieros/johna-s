# PR5 — Sales / POS / Tables / Kitchen / Payments — Closure Evidence

Date: 2026-09-13
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/pr5-sales-pos-kitchen`
PR: #99
Baseline: `main@eaed1c4aee771d2f5ed3c5722e2f1daedcddd0ca`

## Scope

PR5 reviewed the existing Sales/POS/Tables/Kitchen/Payments contracts without reopening already-green behavior unless a regression was proven.

The audited contract includes:

`POS order -> table/operator ownership -> send_to_kitchen -> inventory delta -> payment/settlement -> offline/reconciliation safeguards`

## Audit conclusions

- POS authorization remains Permission-First with granular `pos.*` capabilities. No new role-name authorization was introduced.
- `send_to_kitchen` is the server authority for kitchen consumption and locks the order row with `FOR UPDATE` before calculating the unsent positive delta.
- The order pins `inventory_warehouse_id`; later kitchen sends and settlement do not silently switch an existing order to another warehouse.
- A retry with no additional quantity is a no-op and does not consume inventory again.
- Normal and split settlement paths do not re-deduct inventory already consumed by Kitchen Send.
- Split payment remains atomic.
- Offline/reconciliation logic does not convert an ambiguous/rejected online payment into a fake success and keeps idempotency/cashier identity safeguards.
- Occupied-table/order ownership remains scoped: another user may see occupied state without receiving the protected order id; operator display uses the narrow supported identity contract.

## Proven coverage gap

The existing suite covered Kitchen delta/retry behavior, but it did not explicitly prove two *simultaneous database sessions* sending the same order while the first transaction still held the row lock.

No Business Logic defect was assumed from that missing coverage.

## Change

Added:

`tests/integration/kitchen_send_concurrency.test.ts`

The regression uses independent PostgreSQL sessions and proves:

1. session A calls `send_to_kitchen` and keeps its transaction open;
2. session B calls the same RPC for the same order and remains blocked while A owns the order-row lock;
3. after A commits, B resumes and returns a successful no-op (`items_sent_count = 0`);
4. inventory decreases exactly once;
5. only one `order_kitchen_sends` row exists for the item/order;
6. no duplicate KDS send rows are produced.

The test uses unique disposable Fresh-DB fixtures and explicit cleanup. It does not write Production data.

## Business/data impact

- No runtime SQL changed.
- No migration added.
- No POS/Kitchen/Payment business rule changed.
- No existing user/order/stock/balance data changed, reset, reseeded, or backfilled.
- Production Supabase writes: **NONE**.

## UX Acceptance Gate

Affected POS/Kitchen/Payment/Table surfaces were reviewed for missing required actions, duplicate controls/content, unclear labels/status/help, prerequisite guidance, dangerous-action clarity, Arabic-first/RTL, and unnecessary steps.

No proven UX regression was found that required a behavior change in this PR. Therefore no cosmetic or structural redesign was introduced merely to expand scope. Existing Arabic-first/RTL and permission-gated actions remain intact.

## Verification

Implementation commit:

`e025de3ca641e3e611b41086c4ae32861cbb306b`

Verify #1246 established:

- repository identity ✅
- frontend API parity ✅
- lint ✅
- application typecheck ✅
- test-suite typecheck ✅
- unit ✅
- build ✅
- Fresh DB canonical migrations ✅
- schema ✅
- Permission-First CI seed/drift guard ✅
- integration/security/RLS ✅
- true two-session `send_to_kitchen` concurrency regression ✅

Browser Smoke for the implementation commit is part of the same Verify run. Because closure documentation changes the branch HEAD, a new Full Verify is required on the documentation-complete HEAD before merge regardless of the implementation-run result.

## Merge gate

PR #99 may merge only when the documentation-complete HEAD passes the full required gate:

- lint
- typecheck
- unit
- build
- Fresh DB
- schema
- integration/security/RLS
- Browser Smoke

After merge, verify `main` and Deploy before starting PR6.
