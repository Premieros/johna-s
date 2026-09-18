# Payment Orphan Kitchen Event Fix — 2026-09-18

## Base
- main: `c60900b36a96d18c21706bd3d31683bd7d4eddd7`
- branch: `development/payment-orphan-kitchen-event-fix`

## Production finding
- `ORDER_ITEM_CONFIGURATION_INVALID` reproduced on `Johna's-00111`.
- Root cause: an unsettled, non-voided `order_kitchen_inventory_events` row referenced a deleted `order_item_id`.
- Production read-only audit found 2 orphan event rows across 2 orders, pending quantity 2.

## Fix
- One-time migration repair restores inventory for orphan pending kitchen events through the existing authoritative `_restore_kitchen_inventory_for_void` helper, then marks them voided.
- `guard_sent_order_item_mutation()` now treats unsettled kitchen inventory events as authoritative sent state, not only `order_kitchen_sends`.
- Internal deletion/reduction is rejected with `SENT_ITEM_VOID_INCOMPLETE` until inventory restoration has completed.
- Integration coverage verifies that a sent line cannot be deleted before its pending event is restored.

## Safety
- No RLS weakening.
- No permission changes.
- No direct Production write performed.
- Production migration must not be applied before Full Verify Green and explicit approval.
