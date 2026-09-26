# MAIN TREASURY PAYMENT PERMISSION & TRANSPARENCY — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/main-treasury-pay-permission-20260926`
Current PR: `#376`
Last updated: 2026-09-26

## Work status
State: **BLOCKED**

## Guardrails
- No direct write to main.
- No Production migration before exact-head Full Verify Green + explicit approval.
- No balance/data rewrite.
- No report formula/source changes.
- No printing/KDS/agent changes.
- Permission-First; Super Admin remains the only implicit bypass.

## Baseline
- Base: `main@8ea407b3de1313a4809e409312d9b003e7a3b11e`.
- PR #375 is merged; Production API parity and deploy are Green.
- Current Production balances and historical financial rows are unchanged by this work.
- Cleopatra inspection confirmed the permission mismatch is authorization-related, not a treasury-balance rewrite issue.

## Root-cause ledger
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

## Change ledger
- Added canonical permission `accounting.treasury.main_cash.pay`.
- Added permission contract requiring `procurement.payment.create`.
- Added forward-only migration to allow Main Treasury payment authorization without granting treasury-transfer capability.
- Preserved backward compatibility for existing `accounting.treasury.transfer` holders.
- Payments UI now shows source kind, scope, owning branch, current balance, and an explicit missing-permission message.
- Expenses UI now exposes posted/voided state, account, source, branch, shift, creator, notes and void reason; Excel export includes the same fields.
- Added unit regression test `mainTreasuryPaymentPermission.test.ts`.
- No Production migration has been applied.

## Verification ledger
- Baseline main: `8ea407b3de1313a4809e409312d9b003e7a3b11e`.
- PR #375 Production API parity/deploy: Green.
- Full Verify run `36202103538` on `de4007604b8808439af9c3acf468e8eab09ddb1f`: **FULL GREEN** — worklog ✅, Supabase identity ✅, API contract ✅, lint ✅, typecheck ✅, unit ✅, build ✅, canonical migrations ✅, schema ✅, integration + security/RLS ✅, Browser Smoke ✅.
- Final docs-head exact verification after recording this result: pending.

## Production gate
- BLOCKED pending exact-head Full Verify Green + explicit approval.

## Next action
1. Add permission definition/contract.
2. Update treasury RPC visibility/payment guard.
3. Update Payments UI transparency.
4. Add unit/integration regression coverage.
5. Run Full Verify and stop before merge/Production.


## Mandatory update protocol
- Before every repository write, verify the expected branch HEAD and latest `main`.
- Any unexpected HEAD or divergence requires STOP_AND_RECONCILE.
- After every code batch, update **Change ledger**.
- After every workflow/test result, update **Verification ledger**.
- Merge and Production migration remain blocked until exact-head Full Verify is Green and explicit approval is recorded.
