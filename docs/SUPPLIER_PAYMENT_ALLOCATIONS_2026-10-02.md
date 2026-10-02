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
- No supplier Production migration or historical supplier-data rewrite before exact-head verification and explicit approval.
- Preserve treasury transactions, journal posting semantics, Permission-First, branch isolation, RLS, FIFO, KDS, printing, payments, shifts, and the merged POS idempotency protections.
- Existing supplier payment rows remain legacy audit history; do not guess historical allocations.
- PR #428 is merged on latest `main`; its files are inherited unchanged and are frozen in this track unless a proven compatibility regression requires a reviewed change.

## Baseline
- Original supplier branch base: `main@746b0538b55de88173d0d070d9ff54ca8ea31f42`.
- Latest reconciled `main`: `84f4a1d78dcbe9f637f1e19d26b33de24592da73`.
- PR #428 POS financial-safety work is now present on `main`.
- Production supplier payment flow already posts real treasury transactions and AP journals.
- Production supplier balance currently relies on `purchases.paid_amount` / returns for canonical payable.
- Historical example: الفريدة has a 12,900 supplier payment row but only 8,600 remains applied after an invoice correction.

## Root-cause ledger
- `supplier_payments` records the payment event, but the prior model does not persist how a general payment is distributed across multiple invoices.
- `purchases.paid_amount` therefore acts as both compatibility mirror and allocation truth.
- `update_purchase_invoice` reverses/replaces a purchase; for a paid credit invoice the replacement can start with zero applied payment.
- Without a durable allocation subledger, treasury/journal history survives while invoice allocation can be lost.
- Paid purchase returns can also create supplier credit that the old AP model does not explicitly retain as unapplied credit.

## Change ledger
- Added `supplier_payments.allocation_mode`; existing rows are backfilled to `legacy`, future rows default to `managed`.
- Added append-only `supplier_payment_allocations` apply/unapply event table with branch/supplier/payment/target identity.
- Added transaction-local capture so the existing supplier-payment flow records exact purchase/opening-balance allocations without rewriting treasury or journal posting logic.
- Added managed-allocation release when a paid credit purchase is reduced by correction/return.
- Added automatic reuse of released managed credit on later completed credit invoices.
- Added fail-closed protection for legacy paid invoices when a correction would otherwise require an unprovable allocation.
- Added unit contract coverage and integration coverage for multi-invoice apply, return unapply, credit reuse, and legacy fail-closed behavior.
- Reconciled PR #429 onto latest `main` by taking the full latest-main tree and overlaying only this track's five files.
- No supplier Production DDL or historical data mutation has been applied.

## Verification ledger
- Verify run #3597 failed only at the mandatory work-log gate; required headings were added.
- Verify run #3598 passed the app/unit/build and canonical migration/schema stages; DB integration ran 882 tests with 881 passing.
- Its only failure was this track's test ordering assumption for same-timestamp apply/unapply events; SQL behavior itself was not the failure.
- Commit `ffc1b279ab15024cac47c3d846e47421f63f1764` made that assertion order-independent.
- Exact-head Full Verify run #3600 then completed **Green** on pre-reconciliation HEAD `b65c15d7dc39a0bd55e3b24112bee6a8b2963896`.
- After #3600, PR #428 merged and advanced `main` to `84f4a1d78dcbe9f637f1e19d26b33de24592da73`.
- This merge reconciliation requires a fresh exact-head Full Verify before the gate can open.

## Production gate
State: **BLOCKED**
- Supplier allocation migration is not applied to Production.
- الفريدة is not changed.
- No historical supplier payment row is changed.
- No merge/deploy until exact-head Full Verify is Green on the latest-main-reconciled head and the user explicitly approves merge/deploy.

## Next action
1. Complete latest-main reconciliation as a two-parent merge commit without force push.
2. Run fresh exact-head Full Verify on the reconciled PR #429 head.
3. Fix only proven failures on this branch.
4. Present Green evidence and the exact supplier Production migration/reconciliation scope for explicit approval.

## Mandatory update protocol
- Verify branch HEAD and latest `main` before every repository write.
- Unexpected HEAD/divergence => **STOP_AND_RECONCILE**.
- Repository writes are sequential only.
- Update this log after every meaningful implementation or verification checkpoint.
- Do not merge, deploy, apply the supplier Production migration, or settle legacy supplier data before exact-head Green and explicit approval.
