# FIFO Missing Kitchen Event → Sale Fallback — 2026-09-22

## Identity / Safety
- Repository: `Premieros/johna-s`
- Branch: `development/fifo-missing-kitchen-sale-fallback-20260922`
- Base: `main@67943a445e8444e6c63ef2a382e7c2c9c056b6a6`
- Production Supabase: `azzdesuowpdcoflmyezn`
- Printing remains frozen and untouched.
- No Production migration is applied by this branch.
- No quantity mutation is introduced.

## Trigger
After explicit approval, `raw_opening_cost_apply_repair` was attempted for prepared run:
`32b1a811-b627-43e1-9a81-1e61e4f68aea`.

The transaction failed closed on ledger id `1802`:
`FIFO_KITCHEN_EVENT_MISSING_WITH_LIVE_REFERENCE`.

The guarded transaction rolled back completely:
- repair run stayed `prepared`;
- `applied_at` stayed null;
- `fifo_backfill_run_id` stayed null;
- all 162 opening batches remained zero-cost;
- batch/inventory/ledger quantity hashes remained identical to the pre-apply snapshot.

## Production Evidence
For the 140 eligible opening batches:
- 1,122 affected kitchen-send ledger rows were found.
- 54 rows reference missing kitchen events.
- 38 rows (7 distinct missing event ids) map to a surviving sale/order reference.
- All 7 map to exactly one `completed` sale by invoice number.
- All 7 have zero surviving order matches.
- All 7 have zero journal entries keyed to the missing event id.
- Estimated valuation delta behind these 38 rows is about 642.11.

This pattern is historical ledger survival after kitchen-event cleanup, not active operational traffic.

## Repair
Migration:
`20260922124500_raw_fifo_missing_kitchen_sale_fallback.sql`

The fallback is intentionally narrow:
1. If the kitchen event still exists, use the normal kitchen effect/event path unchanged.
2. If the event is missing and any live order with the same reference number exists: fail closed.
3. If any journal entry is keyed directly to the missing event id: fail closed.
4. If exactly one matching sale exists and its status is `completed`:
   - treat the surviving inventory ledger as the authoritative physical movement;
   - route only the valuation delta to `_fifo_adjust_sale_cogs_delta`;
   - return explicit `historical_sale_fallback=true` metadata.
5. Multiple/non-completed sale matches remain fail closed.
6. True orphan references with no sale/order/journal continue using the existing ledger-only fallback.

Because historical backfill reversal calls the same reference-delta function with the inverse delta, the fallback reverses through the same audited sale COGS mechanism.

## Tests
- Unit contract locks fail-closed conditions and internal-only execution.
- Integration test verifies:
  - missing event + unique completed sale → sale COGS delta;
  - reconciliation journal/adjustment is created;
  - inverse delta removes the adjustment and restores COGS.

## Production State
No retry has been executed. The original opening-cost repair run remains prepared and unchanged.
