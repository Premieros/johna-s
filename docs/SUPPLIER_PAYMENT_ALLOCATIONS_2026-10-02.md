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
- Supplier Production migrations `20261002202827 supplier_payment_allocation_ledger_20261002` and `20261002202952 supplier_payment_allocation_grant_hardening_20261002` were applied with explicit approval.
- Historical supplier financial values were preserved exactly: supplier payment rows 22 / total 234,183.94; purchase rows 198 / paid total 254,348.50; returned total 25,991.20 before and after.
- All 22 pre-existing supplier payments were marked `legacy`; allocation event rows remain 0; no historical allocation was guessed.
- Post-apply review found Supabase project defaults had granted mutation privileges on the new public table. The hardening migration revoked INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER from PUBLIC, anon, authenticated, and service_role; authenticated/service_role retain SELECT only.

## Verification ledger
- Verify run #3597 failed only at the mandatory work-log gate; required headings were added.
- Verify run #3598 passed the app/unit/build and canonical migration/schema stages; DB integration ran 882 tests with 881 passing.
- Its only failure was this track's test ordering assumption for same-timestamp apply/unapply events; SQL behavior itself was not the failure.
- Commit `ffc1b279ab15024cac47c3d846e47421f63f1764` made that assertion order-independent.
- Exact-head Full Verify run #3600 then completed **Green** on pre-reconciliation HEAD `b65c15d7dc39a0bd55e3b24112bee6a8b2963896`.
- After #3600, PR #428 merged and advanced `main` to `84f4a1d78dcbe9f637f1e19d26b33de24592da73`.
- Reconciliation commit `7155967817c2266a1f048016b18bc8863fd79339` rebased the effective tree onto latest `main` without force push.
- Exact-head Full Verify run #3602 completed **Green** on that reconciled head: app/unit/build Green, canonical DB migrations/schema Green, integration + Security/RLS Green, and Browser Smoke Green.
- This documentation-only checkpoint now requires one final exact-head Full Verify before the gate can open.

## Production gate
State: **MIGRATED / MERGE VERIFY PENDING**
- Supplier allocation migration is applied to Production with explicit approval.
- Grant hardening migration is applied to Production and verified read-only.
- `supplier_payment_allocations` has RLS enabled, its SELECT policy is present, internal mutation helpers are not executable by anon/authenticated, and direct table mutation grants are removed from API roles.
- الفريدة is not changed.
- No historical supplier payment row or purchase financial amount was changed.
- PR merge remains blocked until the post-hardening exact-head Full Verify is Green.

## Next action
1. Run exact-head Full Verify including the Production grant-hardening migration and unit contract.
2. Re-check latest `main` and PR mergeability without changing code.
3. If Green, mark PR #429 ready and merge under the already-approved Production execution sequence.
4. Verify post-merge workflow and Production read-only integrity.
5. Keep historical `الفريدة` reconciliation separate until the forward model is deployed and verified.

## Mandatory update protocol
- Verify branch HEAD and latest `main` before every repository write.
- Unexpected HEAD/divergence => **STOP_AND_RECONCILE**.
- Repository writes are sequential only.
- Update this log after every meaningful implementation or verification checkpoint.
- Do not merge/deploy after any new code change without a fresh exact-head Green. Historical supplier reconciliation remains separately approval-gated.
