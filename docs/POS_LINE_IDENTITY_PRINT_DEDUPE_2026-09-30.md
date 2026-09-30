# Emergency POS Line Identity / Print Dedupe — 2026-09-30

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/emergency-pos-line-identity-print-dedupe-20260930`
State: **BLOCKED**

## Incident
- Cleopatra reported repeated/garbled checks, cashier-print complaints, login interruption, and table 41 remaining stuck.
- Smouha reported one Water producing a kitchen ticket quantity of 4.
- Production evidence confirmed duplicate/resumed order-line identity drift and repeated kitchen deltas.
- Smouha order `Johna's-01525` currently has two Water rows, each quantity 4 and each cumulative sent quantity 4.

## Root cause
1. Resumed cart rows carry `order_item_id`.
2. A newly selected identical product does not carry that ID.
3. `addToCart` compared `cartLineKey`, which uses `order_item_id` for resumed lines, so the identical addition was treated as a second line instead of incrementing the persisted line.
4. `cartToItems` dropped `order_item_id`, so `update_order` had no stable line identity and matched by configuration only.
5. With identical lines, persistence could map quantities to the wrong persisted row, causing false kitchen deltas and repeated/oversized kitchen tickets.

## Fix
- Carry `order_item_id` in the cart payload.
- Merge fresh additions into an existing resumed row by business configuration.
- Patch `update_order` to prefer exact `order_item_id` and reject identity mismatch instead of silently swapping rows.
- Include unit price and normalized modifier identity in fallback matching for older clients.
- Keep existing kitchen print idempotency and inventory deduction contracts unchanged.

## Safety
- No direct main write.
- No force push.
- No automatic rewrite of existing live customer quantities.
- No inventory reversal or financial correction is performed by this hotfix.
- Existing affected orders remain data-preserved until explicitly corrected through controlled POS actions.
- Production migration only after exact-head verify is Green.

## Verification
- Production migration parsed/applied successfully inside transaction and ROLLBACK: ✅
- Unit contract: pending CI.
- Full Verify / DB / Browser Smoke: pending.
- Production deployment: pending.
- Post-deploy Smouha/Cleopatra live read-only checks: pending.
