# Supplier Opening Balance Permission — 2026-09-28

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/supplier-opening-balance-permission-20260928`
Current PR: `#398`
Last updated: 2026-09-28 00:30 Cairo

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
Implemented:
- new standalone permission `suppliers.opening_balance.manage`, dependent on `suppliers.view` and classified sensitive;
- dedicated `supplier_opening_balances` table with read RLS and write-only controlled RPC;
- `set_supplier_opening_balance` validates auth, branch access, permission, Work Authorization, positive amount, and non-future opening date;
- opening balance posts a real balanced journal: AP credit vs Opening Balance Equity (3200) debit;
- balance sheet includes opening-equity so the new journal does not make it appear unbalanced;
- AP Aging + Aging Summary include outstanding supplier opening debt;
- supplier statement includes opening amount and an explicit opening-balance event;
- generic supplier payment from treasury settles opening debt first, then oldest purchases;
- supplier form exposes amount/date/note only when the user has the new permission; an existing opening balance becomes read-only;
- frontend API and schema/API contracts updated;
- unit contract added.

## Verification ledger
- Implementation complete; exact-head Full Verify pending.

## Production gate
State: **BLOCKED**
- No Production migration before exact-head Full Verify Green.
- Production apply requires explicit user approval after verification.

## Next action
Open the PR, bind it to the work plan, and run exact-head Full Verify. Fix only failures attributable to this branch.

## Mandatory update protocol
- Re-read branch HEAD before repository writes.
- Update this log after each implementation/verification checkpoint.
- Unexpected HEAD drift = STOP_AND_RECONCILE.
- Keep Production untouched until the Production gate is explicitly opened.
