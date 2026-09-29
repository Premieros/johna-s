# SUPPLIER BALANCE SINGLE SOURCE - ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/supplier-balance-single-source-20260930`
Current PR: `#416`
Last updated: 2026-09-30

## Work status
State: **BLOCKED**

## Guardrails
- Do not rewrite historical purchases, supplier payments, treasury, journals, inventory, printing, or KDS.
- Current supplier payable must come from one canonical source.
- Historical payment logs remain audit detail only.
- No direct main write, no force push, no Production migration before exact-head Green.

## Root cause
- Supplier list and supplier-payment screen use AP aging based on purchases.paid_amount + returned_amount + opening remaining.
- Supplier statement rebuilt current payable from raw supplier_payments plus legacy invoice-time logic.
- Legacy rows can be missing or oversized compared with amounts actually applied to purchases.
- Production examples:
  - Cleopatra / الفريدة: canonical payable 4031.25 while statement-derived result was 0.00 because a 12900 historical payment log exceeds the 8600 actually applied to purchases.
  - Smouha / المتحدة: statement-derived payable was 95.00 higher because paid_amount contains 95.00 without a separate supplier_payments row.

## Change
- get_supplier_statement now uses:
  opening remaining + sum(max(total-paid_amount-returned_amount,0))
  as open_balance.
- total_paid uses opening settled + purchases.paid_amount.
- supplier_payments remains for payment-method/history display only.
- Any legacy mismatch is shown as a display reconciliation row so running balance ends at the same canonical payable.
- No business data is mutated.
- Added regression test supplierBalanceSingleSource.test.ts.

## Verification
- Production read-only mismatch scan identified exactly the current affected suppliers above.
- Payment modal and open invoice selector already use the same purchase open formula.
- Current pay_supplier_from_treasury already blocks PAYMENT_EXCEEDS_AP / PAYMENT_EXCEEDS_INVOICE.
- Exact-head CI pending.

## Production gate
State: **BLOCKED**
- No Production migration applied yet.
- No merge until Fast Verify + Full Verify Green.

## Next action
1. Open Draft PR.
2. Run exact-head Fast Verify + Full Verify.
3. If Green, merge and apply only supplier_balance_single_source migration.
4. Recheck all suppliers for zero difference between statement and AP aging.
