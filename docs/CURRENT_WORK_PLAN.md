# CURRENT WORK PLAN — johna-s — SOURCE OF TRUTH

## Active work
- Track: **Supplier payment allocation ledger**
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Latest main baseline reconciled: `84f4a1d78dcbe9f637f1e19d26b33de24592da73`
- Active development branch: `development/supplier-payment-allocations-20261002`
- Mandatory active work log: `docs/SUPPLIER_PAYMENT_ALLOCATIONS_2026-10-02.md`

## Reconciled predecessor now on main
- PR #428 — POS financial safety hardening — is merged on `main` at `84f4a1d78dcbe9f637f1e19d26b33de24592da73`.
- Its POS/offline/idempotency files and `supabase/api-contract.json` are inherited from latest `main` unchanged by this track.
- This supplier track must not regress POS idempotency, offline replay, KDS, printing, FIFO, shift, or accounting protections.

## Repository branch policy
Long-lived branches intentionally preserved:
1. `main`
2. `development/cleopatra-v811-final`
3. `development/smouha-v811-realtime-final`

Current temporary active development branch:
4. `development/supplier-payment-allocations-20261002`

## Safety fence
- السجل هو المرجع الإجباري للعمل، وهذا الملف يحدد المسار النشط الوحيد.
- CI يجب أن يفشل إذا السجل الإلزامي مفقود أو لا يطابق المسار النشط.
- لا Merge ولا Production migration قبل exact-head Full Verify Green + موافقة صريحة.
- لا Merge إلى `main` إلا بعد نفس البوابة وبموافقة صريحة.
- Single writer on the active development branch.
- No direct write to `main`.
- No force push.
- Unexpected HEAD => **STOP_AND_RECONCILE**.
- No weakening Permission-First, branch isolation, RLS, tests, or Super Admin implicit-bypass rules.
- No Production supplier-data rewrite/reset/reseed to make tests pass.
- Historical supplier payments must not be guessed into allocations.

## Current objective
Add an auditable ERP-style supplier payment allocation subledger while preserving treasury and journal truth:
1. keep `supplier_payments` as the real cash/bank event;
2. record allocation to purchase invoices/opening balances independently;
3. support append-only apply/unapply history;
4. preserve managed settlement through purchase corrections and returns;
5. retain overpayment as unapplied supplier credit;
6. keep historical rows legacy unless separately reconciled;
7. keep `purchases.paid_amount` only as a compatibility mirror during transition.

Detailed execution and verification are maintained only in:
`docs/SUPPLIER_PAYMENT_ALLOCATIONS_2026-10-02.md`

## Historical reconciliation boundary
- The confirmed legacy `الفريدة` discrepancy is not mutated by the forward migration.
- Its 12,900 historical supplier payment remains intact.
- Any settlement of `الفريدة` is a separate controlled reconciliation after the forward model is Production-verified.

## Definition of done
This track is complete only when:
- every new managed supplier payment application is represented by immutable allocation events;
- multi-invoice allocation remains auditable and branch/supplier-safe;
- paid purchase correction/return cannot silently lose a managed settlement;
- legacy paid invoices fail closed when a needed allocation cannot be proven;
- released managed credit remains visible and reusable;
- exact-head Full Verify is Green including DB/security/RLS and Browser Smoke;
- latest `main` is reconciled without losing PR #428 protections;
- no supplier Production migration or historical reconciliation occurs without explicit approval.

> Older work plans/logs are archival evidence only unless this file explicitly names them as active.
