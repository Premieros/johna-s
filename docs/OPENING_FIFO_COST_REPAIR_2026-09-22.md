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
- 141 / 162 have at least one authoritative positive price event (purchase / applied stock count / manual pricing).
- 140 / 162 have authoritative evidence at the opening timestamp itself (applied stock count) and are eligible for automatic repair.
- 1 / 162 has only a later purchase price, 11.81 days after opening; it is now explicitly FUTURE_PRICE_REQUIRES_REVIEW and is not auto-applied.
- 21 / 162 currently have no authoritative price event and remain explicitly unresolved rather than guessed.
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
   - automatic repair requires a positive purchase/count/pricing event at or before opening time;
   - later price events may be shown for review but are never auto-applied;
   - never use an invented cost;
3. prepare a dry-run plan with source/date/reference and unresolved rows;
4. on explicit apply:
   - update only the opening batch unit_cost and matching positive opening ledger valuation;
   - do not change batch quantity or ledger quantity;
   - immediately run the existing historical FIFO prepare/apply engine so every affected sale, kitchen event, production and supported purchase return receives the corrected valuation delta;
   - let the existing FIFO accounting reconciliation post matching COGS/inventory adjustments;
5. support guarded reversal by reversing the generated FIFO backfill first, then restoring only repair-owned opening valuations to zero;
6. keep all unresolved materials untouched: 21 with no candidate plus 1 with future-only evidence.

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


### 2026-09-22 — Targeted repair implemented on development branch

- Added migration: `20260922123000_opening_inventory_fifo_cost_repair.sql`.
- Added internal-only `prepare / apply / reverse` functions.
- Prepare is read-only and records every zero-cost opening batch, exact opening ledger identity, authoritative candidate source/date/reference, and unresolved reason.
- Apply changes valuation only, then atomically invokes the existing historical FIFO prepare/apply engine so historical sale/kitchen/production valuation follows the corrected opening lot cost.
- Apply does not alter physical quantities.
- Rows without a purchase/count/pricing candidate remain untouched.
- Added guarded reversal that first invokes the existing FIFO reversal, then restores only repair-owned opening valuation.
- Added unit safety contract and integration coverage for prepare -> apply -> historical sale COGS delta -> reverse.
- Production remains untouched; no migration or repair function has been executed there.


### 2026-09-22 — Production pre-apply evidence tightened

- Full Verify run 35718453901 was Green end-to-end on the first implementation head, including Browser Smoke.
- Read-only Production review then tightened automatic eligibility:
  - 140 candidates are applied stock-count prices timestamped exactly at opening and are safe for automatic valuation repair.
  - 1 candidate (صوص هانى ماستر) exists only as a purchase 11.81 days after opening and is excluded from automatic repair.
  - 21 have no authoritative price event and remain unresolved.
- Automatic scope is therefore 140 / 162 opening batches; 22 / 162 remain review-only/unresolved.
- Rough read-only valuation impact for opening-lot consumption under those 140 candidates:
  - legacy sale ledger: about +41,761.12
  - kitchen-send ledger: about +10,568.62
  - purchase returns: about +9,601.18
  - production: about +76.38
  These are pre-apply estimates only; the authoritative result must come from the existing FIFO prepare/apply dry-run after migration installation.
- No Production write performed.
