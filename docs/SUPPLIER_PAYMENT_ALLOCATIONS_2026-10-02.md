# SUPPLIER PAYMENT ALLOCATIONS — WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/supplier-payment-allocations-20261002`
Base: `main@746b0538b55de88173d0d070d9ff54ca8ea31f42`
Date: 2026-10-02

Execution mode: **SINGLE_WRITER**
Parallel execution: **FORBIDDEN**
Unexpected HEAD policy: **STOP_AND_RECONCILE**
Write mode: **SEQUENTIAL_ONLY**

## Parallel-work isolation
- PR #428 / `development/pos-financial-safety-hardening-20261002` is open and is treated as external parallel work.
- This branch updates `docs/CURRENT_WORK_PLAN.md` only to satisfy the execution fence. It does not edit `supabase/api-contract.json` or any POS/offline files touched by PR #428.
- Before every write, this branch HEAD must equal the previous expected HEAD.
- Before merge/rebase, reconcile against latest `main` after PR #428 state is known.
- No Production DDL/data mutation from this branch without a separate explicit approval after exact-head verification.

## Objective
Introduce an ERP-style supplier payment allocation subledger so that:
1. supplier payment is the immutable cash/bank event;
2. allocation to purchase invoices is recorded independently;
3. invoice correction can transfer managed allocations without losing payment history;
4. purchase returns can release excess managed allocations into unapplied supplier credit;
5. legacy payment rows remain audit history and are not guessed into allocations;
6. `purchases.paid_amount` remains a compatibility mirror during migration, not the long-term source of truth.

## Confirmed legacy incident
- Supplier: الفريدة.
- Historical payment: 12,900.
- Current applied mirror after invoice correction: 8,600.
- The missing 4,300 allocation was lost when the old invoice revision was reversed/replaced.
- This track will prevent recurrence. Historical settlement of الفريدة is a separate controlled data-reconciliation step.

## Implementation status
State: **IMPLEMENTED_ON_BRANCH / VERIFICATION_PENDING**

## Implemented
- Add append-only `supplier_payment_allocations` event table.
- Mark new supplier payments as allocation-managed while leaving existing rows legacy.
- Add internal allocation/apply/unapply helpers with branch/supplier/payment/invoice validation.
- Capture allocation events from the existing `pay_supplier_from_treasury` flow without changing its treasury or journal posting body; the managed payment id is transaction-local and purchase/opening-balance updates record exact allocation events.
- Add safe release/transfer behavior for managed allocations during paid invoice correction and purchase returns.
- Added unit contract coverage plus integration coverage for multi-invoice allocation, return-driven unapply, automatic reuse of released credit, and fail-closed legacy settlement.
- Treasury and journal posting functions are unchanged.
- Migration file: `supabase/migrations/20261002220000_supplier_payment_allocation_ledger.sql`.
- Tests: `tests/unit/supplierPaymentAllocationLedger.test.ts` and `tests/integration/supplier_payment_allocations.test.ts`.
- Production remains untouched.

## Production gate
State: **BLOCKED**
- No Production migration.
- No historical data rewrite.
- No merge until exact-head verification is Green and the user explicitly approves merge/deploy.


## Verification ledger
- Branch execution fence reconciled at HEAD `c3173fb675c39b06471c6fa882b863ca4de6eda0`.
- Forward migration implementation: complete on branch.
- Unit contract test: committed; CI pending.
- Integration regression: committed; CI pending.
- Exact-head Full Verify: pending.
- PR #428 overlap: only `docs/CURRENT_WORK_PLAN.md` is intentionally overlapping; `supabase/api-contract.json` and POS files remain untouched.
