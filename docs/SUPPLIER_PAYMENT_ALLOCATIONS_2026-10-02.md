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
- This branch intentionally does not edit `docs/CURRENT_WORK_PLAN.md`, `supabase/api-contract.json`, or any POS/offline files touched by PR #428.
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

## Planned implementation
- Add append-only `supplier_payment_allocations` event table.
- Mark new supplier payments as allocation-managed while leaving existing rows legacy.
- Add internal allocation/apply/unapply helpers with branch/supplier/payment/invoice validation.
- Update `pay_supplier_from_treasury` to write allocation events for every applied amount while keeping `purchases.paid_amount` mirrored.
- Add safe release/transfer behavior for managed allocations during paid invoice correction and purchase returns.
- Add regression tests for FIFO multi-invoice allocation, invoice correction, and excess-release behavior.
- Keep treasury and journal posting semantics unchanged.

## Production gate
State: **BLOCKED**
- No Production migration.
- No historical data rewrite.
- No merge until exact-head verification is Green and the user explicitly approves merge/deploy.
