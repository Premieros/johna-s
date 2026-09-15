# Stabilization Work Log — Live

Date: 2026-09-13
Repository: `Premieros/johna-s`
Production branch: `main`
Production Supabase ONLY: `azzdesuowpdcoflmyezn`
Source of Truth: `docs/CURRENT_WORK_PLAN.md`

> The previous long-form stabilization history is preserved verbatim at `docs/archive/STABILIZATION_WORK_LOG_PRE_PR5_2026-09-13.md`. Detailed same-day checkpoints remain in `docs/STABILIZATION_WORK_LOG_2026-09-13_ADDENDUM.md`.

## Permanent execution guardrails

- No direct writes to `main`; no Force Push.
- Never use another repository or Supabase project.
- Permission-First authorization; Super Admin only implicit bypass.
- No weakening RLS/tests.
- No deletion/reset/reseed/rewrite of user data, balances, settings, invoices, stock, or working models for convenience.
- Migrations are forward-only / append-only.
- No Production migration before Full Verify Green.
- Before each write/merge: fetch current `main`, current work branch/PR, and check newer work.
- Standard gate: `Baseline -> Root cause -> Small change -> Focused tests -> Integration/Regression -> Full Verify -> Merge -> Verify main -> Deploy`.
- Mandatory UX Acceptance Gate applies to every touched surface without broad redesign or authorization/business-rule drift.

## Program closure status

- PR1 Architecture / Simplification Map ✅ merged.
- PR2 Inventory Contracts ✅ merged.
- PR3 Catalog 6A/6B/6C/6D ✅ closed.
- PR4 Purchases End-to-End — PR #98 ✅ merged.
  - post-merge `main@eaed1c4aee771d2f5ed3c5722e2f1daedcddd0ca`
  - Verify main #1245 Full Green ✅
  - Deploy #625 Green ✅
  - Production API parity ✅
  - Browser Smoke ✅
  - Production manual writes: NONE.

## PR5 — Sales / POS / Tables / Kitchen / Payments

Status: **CLOSEOUT / FINAL VERIFY REQUIRED ON DOCUMENTATION-COMPLETE HEAD**
Branch: `development/pr5-sales-pos-kitchen`
PR: #99
Baseline: `main@eaed1c4aee771d2f5ed3c5722e2f1daedcddd0ca`
Detailed evidence: `docs/PR5_SALES_POS_KITCHEN_CLOSURE.md`

### Audit result

Existing behavior was inspected before modification. Confirmed contracts include:

- granular Permission-First POS permissions; no new role-name authorization;
- `send_to_kitchen` owns Kitchen inventory consumption and uses an order-row `FOR UPDATE` serialization point;
- positive delta only; retry with no new quantity is a no-op;
- order warehouse pinning and settlement mismatch protection; no silent cross-warehouse switch for an existing order;
- normal/split settlement do not re-deduct Kitchen-consumed stock;
- split payment atomicity;
- offline/reconciliation ambiguity safeguards and cashier/idempotency preservation;
- occupied-table/order ownership and operator identity remain scoped.

### Proven coverage gap

The existing suite did not explicitly prove two simultaneous PostgreSQL sessions calling `send_to_kitchen` against the same order while the first transaction still held the row lock.

### Change

Added only:

`tests/integration/kitchen_send_concurrency.test.ts`

The regression proves:

1. first session sends successfully and retains the order lock until commit;
2. second session blocks behind that lock;
3. after the first commit, the second completes as a successful no-op (`items_sent_count = 0`);
4. stock is reduced exactly once;
5. KDS / `order_kitchen_sends` is written exactly once;
6. no duplicate send row exists.

The regression passed. Therefore no runtime SQL, migration, Kitchen rule, payment rule, or user-data change was made.

### UX Acceptance Gate

POS/Kitchen/Payments/Tables were reviewed for missing actions, duplicate controls, unclear labels/status/help, prerequisite routing, dangerous actions, Arabic-first/RTL, and unnecessary steps. No proven UX regression required a change, so no cosmetic redesign was added merely to expand scope.

### Verification

Implementation commit: `e025de3ca641e3e611b41086c4ae32861cbb306b`
Verify #1246: **FULL GREEN** ✅

- repository identity ✅
- frontend API parity ✅
- lint ✅
- application typecheck ✅
- test-suite typecheck ✅
- unit ✅
- build ✅
- Fresh DB canonical migrations ✅
- schema ✅
- Permission-First CI checks ✅
- integration/security/RLS ✅
- true two-session Kitchen concurrency regression ✅
- Browser Smoke ✅

Closure documentation changes the PR HEAD, so a new Full Verify on that exact documentation-complete HEAD is still mandatory before merge.

Production Supabase writes during PR5: **NONE**.

## Next action

1. Run Full Verify on the documentation-complete PR #99 HEAD.
2. If Full Green, confirm `main` and PR HEAD did not move, mark Ready, and merge using expected-head protection.
3. Verify post-merge `main` and Deploy.
4. Only then start PR6 Shift / Finance / Reports.

---

## 2026-09-15 checkpoint — parallel mobile ownership and pending work

Current repository baseline observed at checkpoint:

- `main@0919ddd171890852b03e712d45b18891ea31f821`
- latest observed merge: PR #133 — manufacturing completion RPC authority.
- merge message records Full Verify #1402 Green on exact head and states no DB migration, Production data, printing, POS, KDS, pricing, or payment change.

### Parallel mobile workstream

- Branch: `development/mobile-delivery-app`
- PR: #132 — Draft / Open.
- Ownership: another model is actively working this branch.
- Rule: this stabilization/documentation workstream must not edit or push to that branch.
- Approved product direction now documented on PR #132:
  - Android app is for dining-room waiter/captain, not delivery captain;
  - customer mode is deferred;
  - the app later reflects the authenticated user's existing system permissions dynamically;
  - manager and waiter use the same app surface but see only granted capabilities;
  - Permission-First remains mandatory; no role-name authorization;
  - existing POS, Production DB, printing, and core business logic are not to be modified from mobile work without separate explicit approval;
  - existing `send_to_kitchen` authority and frozen printing remain unchanged.

### Pending work at this checkpoint

1. PR #132 mobile waiter app remains active under the other model; no cross-editing.
2. Production trial-sales deletion remains unresolved because destructive-action protection blocked the prior attempt; requires an allowed administrative path plus post-delete count verification, without stock rewrites.
3. Any Production migration must be re-evaluated from the current `main`/relevant PR, then pass Full Verify and receive explicit Production approval.
4. Final handover still requires full regression verification on the exact handover head, including Permission-First, branch/warehouse isolation, RLS/security, Kitchen stock authority, approvals, and Browser Smoke where applicable.
5. Because `main` moved repeatedly on 2026-09-15, every new workstream must refresh `main` and inspect open PRs/branches before writing.

No Production write was performed for this checkpoint. No mobile branch code was modified from this documentation workstream.

---

## 2026-09-16 checkpoint — PR #141 Employee Receivables

Branch: `development/employee-receivables`
PR: #141
Baseline at branch creation: `main@3cdea821c0c3a2105ae389db4c6b6d1f3ba9403b`

### Implemented scope

- Added a dedicated Finance page for employee receivables.
- Employee receivable accounts are modeled as rows in `customers` with `customer_type = 'employee'`; they are not system/auth users and do not receive login credentials or permissions.
- Reused canonical customer AR aging (`get_ar_aging`) and generic customer receipt (`receive_payment`), so no parallel receivable balance was introduced.
- Added employee customer creation under existing `customers.manage` authority.
- Employee receivable settlement uses existing `sales.payment.receive` authority.
- Removed the legacy employee-credit panel from Customers because it depended on `employee_user_id -> users` linking.
- Added forward-only migration `20260916000000_employee_customer_classification.sql` to add `customers.customer_type`, preserve historical linked rows as employees, and index `(branch_id, customer_type)`.
- No inventory/FIFO/printing/POS stock movement logic was touched.
- No Production migration or Production data write was performed.

### Verification on implementation head

Workflow: Verify main #1456 / run `35024776511` — **FULL GREEN** ✅

- repository identity ✅
- frontend API contract ✅
- lint ✅
- application typecheck ✅
- test-suite typecheck ✅
- unit ✅
- build ✅
- Fresh DB canonical migrations ✅
- schema verification ✅
- Permission-First CI setup ✅
- integration/security/RLS regression ✅
- Browser Smoke ✅

This documentation commit changes the PR HEAD, therefore Full Verify must run again on the new exact head before merge. Production migration remains blocked until a separate explicit approval after final Full Green.
