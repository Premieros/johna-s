# FIFO zero-cost historical price fallback — 2026-09-25

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/fifo-zero-cost-price-fallback-20260925`
Current PR: `#362`
Last updated: 2026-09-25 01:48 Africa/Cairo
State: **BLOCKED**

## Work status
- Previous opening/FIFO repair is applied on Production and balanced.
- Remaining zero-cost raw consumption is under read-only audit.
- New engineering work is isolated on this branch; no Production writes in this phase.
- Single Writer only; unexpected HEAD means STOP_AND_RECONCILE.

## Guardrails
- Never modify `main` directly.
- No Production migration or repair apply before exact-head Full Verify Green and explicit user approval.
- Preserve all physical stock quantities exactly.
- Never invent or backfill a price from a future event when no prior authoritative event exists.
- Any provisional historical price on open FIFO debt must be offset during later receipt settlement so COGS is not double-counted.
- Printing, Print Agent, routing, KDS, send-to-kitchen, shifts, and Work Authorization are out of scope.
- Permission-First, branch isolation, and internal-only repair functions remain mandatory.

## Baseline
- Smouha branch: `19c3fd23-d784-455b-8840-f4f2ac619651`.
- Applied opening repair run: `dce504ae-4950-40b9-b120-f0d72a9e3015`.
- Applied FIFO run: `9973998f-c8c8-4d22-91f5-a8a7de619afc`.
- Post-repair COGS balance: 109210.71; trial balance remained balanced at 741060.40 debit = credit.
- Remaining zero-cost consumption: 4047 rows / 89 raw materials.
- Rows with an authoritative positive price event at or before consumption: 1656 rows / 31 materials.
- Candidate value if fully priced at the latest prior event: 34763.53.
- Rows with no prior authoritative price: 2391 rows; these stay unresolved automatically.
- Among priceable rows: 1382 have a FIFO debt, 1236 still have open debt, open debt quantity 460.3334.
- Supported reference mix is only kitchen_send, sale, production, and purchase_return.

## Root-cause ledger
- FIFO correctly leaves unresolved oversold quantity at zero until a later positive receipt settles the debt.
- Some historical zero-cost rows nevertheless have a positive authoritative price event that predates the consumption.
- Applying that price directly without changing debt settlement would double-count cost when a later receipt settles the same debt.
- Correct design: apply a documented historical fallback to the zero-cost source row, track the open-debt portion as provisional, and when a later positive-cost receipt settles that debt post only actual minus provisional cost.
- A later zero-cost receipt must not erase a prior authoritative fallback; it closes quantity while preserving the fallback basis.
- Rows without open debt can receive the fallback as final valuation because no later debt settlement can add cost to them.

## Change ledger
- Added migration `20260925013000_raw_fifo_prior_price_fallback.sql` with audited prepare/apply/reverse tables and RPCs.
- Added `raw_fifo_debt_price_estimates` to track provisional open-debt valuation.
- Extended `_raw_fifo_settle_receipt` so later positive-cost receipts post actual-minus-estimate only; zero-cost receipts preserve fallback basis.
- Added unit contract `raw_fifo_prior_price_fallback.test.ts`.
- Added integration test `raw_fifo_prior_price_fallback.test.ts` covering quantity invariance, difference-only settlement, zero-cost receipt preservation, reversal refusal after estimate consumption, and unresolved no-price rows.\n- Added follow-up migration `20260925014500_raw_fifo_prior_price_prepare_null_guard.sql` after Production exposed SQL three-valued NULL eligibility for rows with no prior price.

## Verification ledger
- Read-only Production classification completed.
- No Production writes performed for this phase.
- Exact-head Full Verify on `9d10c979a867405e0f119e0da092220ac8503d7b`: Green (verify + DB/integration + browser-smoke).\n- Production migration `raw_fifo_prior_price_fallback` applied after that Green gate.\n- First Production prepare failed atomically before valuation/quantity mutation because no-price rows produced NULL `eligible` against a NOT NULL column.\n- Added follow-up migration `20260925014500_raw_fifo_prior_price_prepare_null_guard.sql` using explicit `COALESCE(...,false)`.\n- Added unit + integration coverage for `NO_PRIOR_AUTHORITATIVE_PRICE`; new exact-head Full Verify pending.

## Production gate
State: **BLOCKED**
- Code complete: follow-up pending exact-head verification.
- Exact-head Full Verify Green: no.
- Production migration approval: not yet eligible.
- Production repair apply approval: not yet eligible.

## Next action
1. Add audited prepare/apply/reverse tables and RPCs for prior-price zero-cost fallback.
2. Extend `_raw_fifo_settle_receipt` to consume provisional estimate basis and post only the actual-vs-estimate difference.
3. Add unit and integration tests for no-double-cost, zero-cost future receipt preservation, reversal guard, and quantity invariance.
4. Run exact-head Full Verify.
5. Re-audit Production candidate counts before any apply.

## Mandatory update protocol
- Read this file and `docs/CURRENT_WORK_PLAN.md` before every repository write.
- Before every write, verify branch HEAD equals the last expected successful write.
- Update Change ledger after code/schema changes.
- Update Verification ledger after every test/workflow result.
- Keep Production gate **BLOCKED** until exact-head Full Verify is Green and explicit Production approval is recorded.
