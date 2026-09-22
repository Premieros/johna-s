# Opening Inventory / FIFO Cost Repair — Plan & Work Log — 2026-09-22

## Identity / Safety Lock

- Repository: `Premieros/johna-s`
- Branch: `development/opening-fifo-cost-repair-20260922`
- Base: latest `main` at branch creation (`a59f4d91035f6637e25283ef76dcd0644a39e479`)
- Production Supabase: `azzdesuowpdcoflmyezn`
- Production inspection: read-only until Full Verify Green + explicit approval.
- Printing / Print Agent / routing / receipts: frozen and untouched.
- No recipe quantities, sale totals, payments, or physical stock quantities may be rewritten by this repair.

## Confirmed Existing Repair

The 2026-09-21 FIFO debt/settlement repair is present and applied in Production.

Applied historical run:
- run id: `ce72c9e6-3ab0-4eaa-aac8-0642d24175c7`
- status: `applied`
- 9,452 historical consumption rows replayed
- 1,022 valuation rows changed
- net historical FIFO valuation delta: +21,496.20
- unresolved quantity at that cutoff: 10,804.8299

Live receipt settlement remains active through `_raw_fifo_settle_receipt`.

## Newly Confirmed Gap

The existing FIFO repair correctly handles **negative/oversold debt**, but does not invent a value for **positive opening inventory originally imported at unit_cost = 0**.

Current Production evidence:
- 162 zero-cost `opening_inventory` raw batches exist in Smouha.
- 93 still have positive quantity; 69 are already exhausted.
- every one of the 162 has exactly one positive opening ledger receipt, so identity is unambiguous.
- 141 / 162 have at least one authoritative positive price event (purchase / applied stock count / manual pricing) that can anchor a repair.
- 21 / 162 currently have no authoritative price event and must remain explicitly unresolved rather than guessed.
- 93 remaining positive zero-cost opening batches hold 1,469.4842 units.
- the 79 remaining-positive batches with a price candidate represent about 67,366.78 of currently unvalued opening inventory at their selected candidate prices.

Example confirmed today:
- Turkish Coffee S consumes 0.012 of `بن ك` and 2 sugar packs — quantities match the recipe.
- `بن ك` was consumed from an older positive `opening_inventory` batch with unit_cost 0, therefore FIFO correctly chose the oldest batch but produced zero COGS.
- sugar was true oversold debt; the existing FIFO debt repair correctly created a debt and will value it only when a later receipt settles it.

## Repair Goal

Repair the missing **opening valuation** without replacing the existing FIFO engine:

1. identify every zero-cost opening raw batch and its unique opening ledger row;
2. choose a traceable authoritative cost candidate:
   - prefer the latest positive purchase/count/pricing event at or before opening time;
   - otherwise use the earliest positive authoritative event after opening time;
   - never use an invented cost and never auto-repair a row with no authoritative event;
3. prepare a dry-run plan with source/date/reference and unresolved rows;
4. on explicit apply:
   - update only the opening batch unit_cost and matching positive opening ledger valuation;
   - do not change batch quantity or ledger quantity;
   - immediately run the existing historical FIFO prepare/apply engine so every affected sale, kitchen event, production and supported purchase return receives the corrected valuation delta;
   - let the existing FIFO accounting reconciliation post matching COGS/inventory adjustments;
5. support guarded reversal by reversing the generated FIFO backfill first, then restoring only repair-owned opening valuations to zero;
6. keep the 21 no-candidate materials untouched and visible as unresolved.

## Acceptance Criteria

- physical stock quantity before = physical stock quantity after;
- opening batch/ledger identity is exact and assumption-guarded;
- no cross-branch or cross-warehouse fallback;
- historical consumption of a repaired opening batch receives the candidate FIFO cost;
- kitchen event/effect and sale COGS propagation continues through existing FIFO reconciliation helpers;
- unresolved zero-cost opening rows are not guessed;
- prepare never mutates Production data;
- apply is service-role/postgres only and is idempotent;
- reversal is stale-guarded by the existing FIFO reversal contract;
- no printing tables/functions/jobs are touched.

## Execution Log

### 2026-09-22 — Audit complete

- Confirmed quantity consumption formula is correct for the sampled current recipe flow.
- Confirmed the dominant zero-cost problem is valuation source, not recipe quantity.
- Confirmed 162 zero-cost opening batches, all with exactly one opening ledger receipt.
- Confirmed 141 have an authoritative candidate and 21 do not.
- Chosen approach: additive prepare/apply/reverse repair that reuses the already-tested FIFO historical reconciliation engine.
- No Production write performed.
