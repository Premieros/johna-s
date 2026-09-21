# Shift Override + Catalog Visibility Repair — 2026-09-22

Verified Production symptoms:
- Cleopatra has 249 active products and 401 active raw materials in the database.
- The active branch manager has branch access plus products.view, pos.view, raw_materials.view, shifts.close, shifts.manage and shifts.close_with_open_orders.
- RLS impersonation for that user returns all 249 products and 401 raw materials, so the data itself is present and authorized.
- The Production close_shift_with_open_orders RPC was a compatibility fail-closed stub even though the permission and frontend API wrapper still existed.
- RawMaterialsPage used a stale embedded PostgREST relationship name (unit:units(*)) while raw_materials.unit_id references measurement_units.

Repair:
- restore the permissioned close-with-open-orders RPC; it closes only the shift and preserves orders/tables unchanged;
- expose the separate override action in ShiftsPage only when shifts.close + shifts.close_with_open_orders are both granted;
- make ProductsPage and RawMaterialsPage primary list reads relationship-independent, using already-loaded category/unit metadata for labels;
- no print-agent, print queue, kitchen-send or inventory-mutation logic changed.

Rollback base: a0ddd624c284372f2004e6f62079b2ca81f2cf36
