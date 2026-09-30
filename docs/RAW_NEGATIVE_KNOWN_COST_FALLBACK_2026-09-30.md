# RAW NEGATIVE KNOWN COST FALLBACK — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/raw-negative-known-cost-fallback-20260930`
Current PR: `#425`
Last updated: 2026-09-30 22:25 Africa/Cairo

## Work status
State: **BLOCKED**

## Guardrails
- No direct write to `main`.
- No Production migration before exact-head Full Verify Green.
- User approved this bounded correction in the current conversation.
- Do not modify historical experimental purchase invoices.
- Do not change physical raw-material quantities.
- Do not rewrite `inventory_ledger.total_cost`, journal COGS, sales, purchases, settlements, or historical actual FIFO cost.
- Estimated negative valuation only may use a known fallback price.
- Printing, Print Agent, KDS, POS, shifts, payments and send-to-kitchen behavior are out of scope.
- Branch/warehouse isolation, Permission-First and RLS remain unchanged.

## Baseline
- Branch created from `main@729e30f4471679751220a51c6fd53f3d9a1d3dc2`.
- Production read-only audit found zero-cost negative debt materials even when a known price exists.
- Cleopatra: 59 zero-cost negative materials; 37 have a known price and 22 have no known price.
- Smouha: 46 zero-cost negative materials; 14 have a known price and 32 have no known price.
- Existing migration `20260926124500_raw_negative_estimated_valuation.sql` resolves same-warehouse FIFO/batch history only and can return zero even when normalized purchase ledger history or `default_cost` exists.

## Root-cause ledger
- Oversold debt must remain zero in actual ledger COGS until real receipt settlement; this is correct and must not change.
- The display/estimate helper `_raw_last_known_fifo_cost` currently searches a prior positive-cost issue and current/real batch history, but does not fall back to normalized positive receipt ledger history or `raw_materials.default_cost`.
- Positive purchase/receipt inventory-ledger rows already store stock-unit-normalized cost, so they are safer than reading purchase-item unit cost directly.
- Therefore a material may have a valid known price but still appear as zero estimated negative cost.

## Change ledger
- Work plan activated on this branch.
- Planned price hierarchy for estimate-only paths:
  1. latest same-warehouse real FIFO issue cost;
  2. latest same-warehouse positive inventory-ledger purchase/receipt cost;
  3. latest same-warehouse real batch cost;
  4. branch raw-material `default_cost`;
  5. zero only if all sources are unavailable.
- Existing actual ledger/journal values remain untouched.
- Historical experimental purchase invoices remain untouched.

## Verification ledger
- Production audit complete before code change.
- Exact-head Full Verify: pending.
- DB integration/security/RLS: pending.
- Browser Smoke: pending.
- Post-migration Production read-only valuation comparison: pending.

## Production gate
State: **BLOCKED**
- Production migration not applied.
- Merge not performed.

## Next action
1. Add a forward-only migration implementing the estimate-only known-cost fallback.
2. Add regression tests proving known prices replace zero estimates while truly unpriced materials remain zero/unpriced.
3. Open PR and run exact-head Full Verify.
4. Verify no runtime diff outside raw estimated valuation.
5. Apply Production migration only after Green verification.

## Mandatory update protocol
- Before every repository write, verify expected branch HEAD and latest `main`.
- Unexpected HEAD/divergence => STOP_AND_RECONCILE.
- Record every code/test/CI result in this log.
- No force push.
- No merge or Production migration until exact-head Full Verify is Green.
