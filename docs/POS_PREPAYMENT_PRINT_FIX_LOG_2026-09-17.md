# POS Prepayment Print Fix Log — 2026-09-17

## Scope
Fix the Print button on the POS sale screen when printing a customer receipt before payment.

## Repository identity
- Repository: `Premieros/johna-s`
- Development branch: `development/pos-prepayment-print-fix`
- Base branch: `main`
- Production Supabase: `azzdesuowpdcoflmyezn` (not modified)

## Root cause
The POS wrapper `src/features/pos/hooks/usePosOrder.ts` routed open-order printing through settlement preview first. That caused the sale-screen Print action to call `get_order_settlement_preview(p_order_id)` before a receipt could be printed. The RPC is part of settlement/payment behavior and must not be required for the read-only prepayment receipt path.

The underlying base POS hook already owns the correct open-order print behavior and builds the receipt from the live cart, marking it as an open order.

## Implementation
### Commit 1
- SHA: `d3d4bfde9b30be355344896a598311a4b342d199`
- Message: `fix(pos): print open order without settlement RPC`
- File changed: `src/features/pos/hooks/usePosOrder.ts`
- Change: open-order printing now delegates directly to `base.printReceipt()` when the cart has items. Settlement receipt printing remains available for a completed settlement receipt. Payment and settlement logic were not changed.

### Commit 2
- SHA: `e907192a757816aa0d0cf0bc33100c45436e2214`
- Message: `test(pos): guard open-order print from settlement RPC`
- File added: `tests/unit/pos-open-order-print.test.tsx`
- Regression: verifies that the open-order Print action calls the base print path and does not call `fetchOrderSettlementPreview()`.

## Pull request
- PR: #175
- State: Draft
- Purpose: run CI only; do not merge yet.

## Database / production safety
- New migration: none
- Production migration executed: no
- Production data modified: no
- RLS changed: no
- Printing agent / printer configuration changed: no
- Payment / settlement logic changed: no

## Verification
CI is expected to run the repository `Verify main` workflow for the draft PR, including lint, application/test typecheck, unit tests, build, fresh Postgres migration/schema verification, integration/security/RLS tests, and browser smoke tests.

Current status at log creation: CI pending.

## Remaining
1. Inspect PR #175 CI results.
2. Fix any failure on `development/pos-prepayment-print-fix` only.
3. Keep PR unmerged until explicit user approval.
