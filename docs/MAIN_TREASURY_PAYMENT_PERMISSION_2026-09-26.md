# MAIN TREASURY PAYMENT PERMISSION & TRANSPARENCY — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/main-treasury-pay-permission-20260926`
Current PR: `#376`
Last updated: 2026-09-26

## Work status
State: **VERIFYING**

## Guardrails
- No direct write to main.
- No Production migration before exact-head Full Verify Green + explicit approval.
- No balance/data rewrite.
- No report formula/source changes.
- No printing/KDS/agent changes.
- Permission-First; Super Admin remains the only implicit bypass.

## Root cause
- Supplier payment requires `procurement.payment.create`.
- Organization-scoped Main Treasury is additionally hidden/blocked by `accounting.treasury.transfer`.
- This second requirement is not expressed as a dedicated payment permission, so a user can appear authorized to pay suppliers while Main Treasury is silently unavailable.
- Production inspection of Cleopatra role state confirmed branch-manager permissions do not currently contain either supplier-payment creation or Main Treasury transfer/payment capability.

## Intended fix
- Add explicit permission `accounting.treasury.main_cash.pay` = pay from Main Treasury.
- Main Treasury visibility for supplier-payment source is granted only when user has both `procurement.payment.create` and the new Main Treasury payment permission.
- Keep `accounting.treasury.transfer` reserved for actual transfers between treasuries.
- Payment screen must show source name, scope/kind, branch owner, current balance, and explicit reason when Main Treasury is unavailable.
- Existing payments and balances are untouched.

## Verification ledger
- Baseline main: `8ea407b3de1313a4809e409312d9b003e7a3b11e`.
- PR #375 Production API parity/deploy: Green.
- Draft PR #376 opened. Exact-head verification for this change: pending.

## Production gate
- BLOCKED pending exact-head Full Verify Green + explicit approval.

## Next action
1. Add permission definition/contract.
2. Update treasury RPC visibility/payment guard.
3. Update Payments UI transparency.
4. Add unit/integration regression coverage.
5. Run Full Verify and stop before merge/Production.
