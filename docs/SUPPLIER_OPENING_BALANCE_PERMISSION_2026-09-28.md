# Supplier Opening Balance Permission — 2026-09-28

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/supplier-opening-balance-permission-20260928`
Current PR: `#0`
Last updated: 2026-09-28 00:20 Cairo

## Work status
State: **BLOCKED**

Implementation is in progress. Merge and Production are blocked until exact-head Full Verify is Green and the user explicitly approves Production.

## Guardrails
- Permission-First.
- Super Admin implicit bypass only.
- No direct edits to main.
- No weakening of RLS.
- No printing / Print Agent / routing / KDS / send-to-kitchen changes.
- No unrelated POS, shift, treasury, or inventory behavior changes.
- Supplier opening balance must be real accounting data, not a display-only supplier.balance field.

## Baseline
- Supplier form currently carries a hidden `balance` field but does not expose it.
- Supplier list balance comes from AP Aging, not directly from `suppliers.balance`.
- AP Aging and supplier statement currently derive payable balance from purchases/payments only.
- Supplier payments post to the AP control account and are shown in supplier statements.

## Root-cause ledger
- There is no controlled UI/API path for supplier opening balances.
- Writing `suppliers.balance` alone would not reach AP Aging, supplier statements, or the general ledger.
- A dedicated opening-balance record and posting path are required.

## Change ledger
Pending:
- new permission `suppliers.opening_balance.manage`;
- dedicated supplier opening-balance table/RPC with branch + permission enforcement;
- real AP journal posting;
- AP Aging + supplier statement inclusion;
- supplier payment allocation support for opening debt;
- supplier form field visible only with the new permission.

## Verification ledger
Pending.

## Production gate
State: **BLOCKED**
- No Production migration before exact-head Full Verify Green.
- Production apply requires explicit user approval after verification.

## Next action
Implement the permission, canonical accounting path, reports, supplier UI, and regression tests on this branch.

## Mandatory update protocol
- Re-read branch HEAD before repository writes.
- Update this log after each implementation/verification checkpoint.
- Unexpected HEAD drift = STOP_AND_RECONCILE.
- Keep Production untouched until the Production gate is explicitly opened.
