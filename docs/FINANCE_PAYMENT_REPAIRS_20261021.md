# Finance payment repairs — 2026-10-21
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/finance-payment-feedback-20261021`
Current PR: `529`
Last updated: 2026-10-21

## Work status
State: **BLOCKED**
Owner authorized a root-cause repair, staged before separate production release approval.

## Guardrails
Frontend plus one guarded SQL projection repair candidate; no production SQL/migration/RLS/security/ledger/print/agent mutation during preparation. No live financial operation. Preserve authoritative rejection; no automatic retry or account/branch switch. Local Windows pilot remains excluded.

## Baseline
main c42e516f425175fc5bdd413e061601f76e9817c1 (#528). Both live treasury read and transfer use the same opening plus GL balance formula. #528 did not modify either function or these screens. Screenshots/rejections predate that release.

## Root-cause ledger
Missing translations turn PAYMENT_EXCEEDS_INVOICE and INSUFFICIENT_TREASURY_BALANCE into generic system errors. Invoice selection retains total party debt. Reads hide errors, read unbounded history, and lack stale-response guards. Additional frontend audits omit branch although RLS checks branch. Treasury display is a load-time snapshot and discards the server rejection's available/requested balance fields. Exact historical server balance for the screenshot was not retained; do not claim a proven arithmetic discrepancy or a last-release regression.

## Change ledger
Scoped reads and dialog binding prevent old branch results from being reused. Invoice selections use their own outstanding balance; reads page at 500 rows, cap at 5000 and fail without partial output. Business rejection shows authoritative available/open values and refreshes only reads. Ambiguous transport outcomes block repeat submission and require history review. Customer/deposit/withdrawal UI audits carry the submitted operation branch; supplier and transfer RPCs already own transactional audits, so duplicate frontend writes are removed. Additional root bug: receive_payment selects an anonymous record lacking id/paid_amount/refunded_amount fields, then accesses them. One guarded replacement names those fields; unchanged permissions, accounting and employee delegation. CLI generated 20261021130323_finance_receive_payment_projection.sql, not applied to production.

## Verification ledger
Read-only live catalog/source and historical issue codes verified; 41/42 focused assertions passed in a contended run and the single timeout passed when isolated (6/6 component checks); full final exact-head checks required. PGlite also verifies the actual guarded rollback file; no financial mutation. Focused component checks passed (6). PGlite reproduced baseline TRANSACTION_FAILED and passed candidate authorization, net-refund balance, invoice cap, allocation, journal rollback, employee delegation, metadata preservation and exact restore. App/test typechecks passed. Exact-head CI pending.

## Production gate
State: **BLOCKED**
No Merge ولا Production migration during preparation; separate explicit owner release approval required after review.

## Next action
Implement scoped reads, clear business feedback, bounded complete invoice selection and audit attribution; test without production writes.

## Mandatory update protocol
Reconcile main/head before mutation; update material findings and checks. Never claim an ambiguous transport failure means no financial operation committed.
