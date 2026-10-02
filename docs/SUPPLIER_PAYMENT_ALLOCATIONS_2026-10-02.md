# SUPPLIER PAYMENT ALLOCATIONS — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/supplier-payment-allocations-20261002`
Current PR: `#429`
Last updated: 2026-10-02

Execution mode: **SINGLE_WRITER**
Parallel execution: **FORBIDDEN**
Unexpected HEAD policy: **STOP_AND_RECONCILE**
Write mode: **SEQUENTIAL_ONLY**

## Work status
State: **BLOCKED**

## Guardrails
- No direct write to `main`.
- No force push.
- No Production migration or historical supplier data rewrite before exact-head verification and explicit approval.
- Preserve treasury transactions, journal posting semantics, Permission-First, branch isolation, RLS, FIFO, KDS, printing, payments, and shifts.
- Existing supplier payment rows remain legacy audit history; do not guess historical allocations.
- PR #428 is external parallel work. Do not edit its POS/offline files or `supabase/api-contract.json`.
- `docs/CURRENT_WORK_PLAN.md` overlap exists only because each executable branch must declare its own active track; reconcile that file before merge.

## Baseline
- Branch base: `main@746b0538b55de88173d0d070d9ff54ca8ea31f42`.
- Production supplier payment flow already posts real treasury transactions and AP journals.
- Production supplier balance currently relies on `purchases.paid_amount` / returns for canonical payable.
- Historical example: الفريدة has a 12,900 payment row but only 8,600 remains applied after an invoice correction.

## Root-cause ledger
- `supplier_payments` records the payment event, but the prior model did not persist how a general payment was distributed across multiple invoices.
- `purchases.paid_amount` therefore acted as both compatibility mirror and allocation truth.
- `update_purchase_invoice` reverses/replaces a purchase; for a paid credit invoice the replacement can start with zero applied payment.
- Without a durable allocation subledger, the payment survives in treasury/journal history while its invoice allocation can be lost.
- Paid purchase returns can also create supplier credit that the old AP presentation does not model explicitly.

## Change ledger
- Added `supplier_payments.allocation_mode`; existing rows are backfilled to `legacy`, future rows default to `managed`.
- Added append-only `supplier_payment_allocations` apply/unapply event table with branch/supplier/payment/target identity.
- Added transaction-local capture so the existing supplier-payment RPC records exact purchase/opening-balance allocation events without changing its treasury or journal body.
- Added managed-allocation release when a paid credit purchase is reduced by correction/return.
- Added automatic reuse of released managed credit on later completed credit invoices.
- Added fail-closed protection for legacy paid invoices when a correction would otherwise require an unprovable allocation.
- Added unit contract coverage and integration coverage for multi-invoice apply, return unapply, credit reuse, and legacy fail-closed behavior.
- No Production DDL or data mutation has been applied.

## Verification ledger
- Verify run #3597 failed only at the mandatory work-log gate; the required headings were then added.
- Verify run #3598 passed the work-log gate, locked Supabase identity check, frontend API-contract check, lint, application typecheck, test-suite typecheck, unit suite, build, canonical migration apply, and schema verification.
- DB integration then ran 882 tests; 881 passed and the only failure was this track's new allocation test.
- The failure was test-only: apply/unapply events created inside the same transaction can share a timestamp, while the assertion incorrectly depended on row order.
- Commit `ffc1b279ab15024cac47c3d846e47421f63f1764` makes that assertion order-independent; allocation SQL behavior was not changed.
- Exact-head Full Verify must now be rerun on the post-log HEAD.

## Production gate
State: **BLOCKED**
- Migration not applied to Production.
- الفريدة not changed.
- No historical payment row changed.
- No merge until exact-head Full Verify is Green and the user explicitly approves merge/deploy.

## Next action
1. Re-run exact-head Full Verify after the order-independent integration assertion fix.
2. Fix only proven failures on this branch.
3. Reconcile any overlap with PR #428 before merge.
4. Present Green evidence and the exact Production migration/data-reconciliation scope for explicit approval.

## Mandatory update protocol
- Verify branch HEAD before every repository write.
- Unexpected HEAD/divergence => **STOP_AND_RECONCILE**.
- Repository writes are sequential only.
- Update this log after each meaningful implementation or verification checkpoint.
- Do not merge, deploy, apply Production migration, or settle legacy supplier data before exact-head Green and explicit approval.
