# Smouha → Cleopatra Catalog Copy — Dry Run Report

Date: 2026-09-19

## Safety boundary

This branch contains planning and read-only diagnostics only.

- Repository: `Premieros/johna-s`
- Work branch: `development/smouha-cleopatra-catalog-dry-run-20260919`
- Base: `main@ffdc8259b8c10bd355b0be50a1055d4ddeb5abd8`
- Production project inspected read-only: `azzdesuowpdcoflmyezn`
- No Production INSERT/UPDATE/DELETE.
- No migration applied.
- No changes to printer stations, Print Agent, print queues, send_to_kitchen, KDS, shifts, business-day close, sales, purchases, stock or financial history.
- No files from concurrent PR #236 were touched.

## Branch identities

- Smouha: `19c3fd23-d784-455b-8840-f4f2ac619651`
- Cleopatra: `279e6662-e901-40b2-9170-7dda0b471ba7`

## Read-only inventory snapshot

| Entity | Smouha | Cleopatra |
|---|---:|---:|
| Categories | 26 | 0 |
| Raw materials | 401 | 0 |
| Products | 254 | 0 |
| Recipes | 254 | 0 |
| Recipe items | 1080 | 0 |
| Manufactured inventory units | 17 | 0 |
| Inventory-unit raw-material recipe rows | 68 | 0 |
| Inventory-unit component-unit recipe rows | 3 | 0 |
| Product → inventory-unit links | 55 | 0 |

There are no current name/code overlaps in Cleopatra because the destination catalog is empty.

## Required dependent data

The Smouha products also use modifiers:

- Modifier groups: 4
- Modifier options: 8
- Product/group links: 21
- Modifier inventory effects: 12

These are catalog dependencies for affected products. If the copy is later approved, they should be copied with new Cleopatra IDs and their inventory effects must point only to cloned Cleopatra raw materials/inventory units.

## Important constraints found

1. `raw_materials.code` is globally unique, not branch-scoped.
2. `inventory_units.code` is globally unique, not branch-scoped.
3. Source codes therefore cannot be copied verbatim into new Cleopatra rows.
4. Proposed deterministic rule: `CLP-<source_code>`.
5. Dry Run collision check for that prefix: **0 raw-material collisions, 0 inventory-unit collisions**.
6. Product SKU/barcode fields do not have the same global unique indexes and can remain unchanged unless a later validation discovers a business-level collision.

## Source relationship integrity

Read-only checks found:

- Cross-branch product/category references: 0
- Cross-branch recipe/product references: 0
- Cross-branch recipe/raw-material references: 0
- Cross-branch product/inventory-unit links: 0
- Cross-branch manufactured/raw-material references: 0
- Cross-branch manufactured/component-unit references: 0
- Cross-branch modifier group/product references: 0
- Cross-branch modifier option/group references: 0
- Cross-branch modifier inventory effects: 0
- Products without recipes: 0

One active product is intentionally/accidentally uncategorized in the source and must not be silently changed during copy:

- `Ice Mocha Latte` — source id `fe4a8dbb-77ef-4c9e-9370-6fb3ce9e28a5`

The safe default is to clone it with `category_id = NULL`; correcting its category should be a separate explicit data decision.

## Category → kitchen station dependency

All 26 Smouha categories currently reference a Smouha kitchen station.

Cleopatra already has active stations with matching codes:

- `kit` → مطبخ
- `بار` → بار
- `كاش` → كاش

No source `kitchen_station_id` may be copied across branches.

For the later write phase, the safe mapping is by existing station `code` to the already-created Cleopatra station. This creates only the new category relationship; it must not create/update/delete printer stations or change Print Agent configuration.

## Proposed later copy order

1. Categories → new Cleopatra IDs, with station mapping by existing Cleopatra station code.
2. Raw materials → new Cleopatra IDs, `CLP-` code prefix.
3. Manufactured inventory units → new Cleopatra IDs, `CLP-` code prefix.
4. Inventory-unit recipes and unit-to-unit components → remapped to Cleopatra IDs.
5. Products → new Cleopatra IDs and remapped category IDs.
6. Recipes → new Cleopatra IDs tied to cloned products.
7. Recipe items → remapped to cloned raw materials.
8. Product → inventory-unit links → remapped to cloned IDs.
9. Modifier groups/options/product links/effects → cloned and fully remapped to Cleopatra IDs.
10. Post-copy assertions: all destination references belong to Cleopatra; stock/history tables remain untouched.

## Explicit exclusions from the later copy

Do not copy:

- warehouse stock or balances
- raw material inventory balances
- batches
- purchases
- inventory movements / ledger history
- sales / orders / payments
- expenses
- shifts / business days
- customer/supplier balances
- printer stations or Print Agent configuration
- historical costing transactions

Only catalog/master definitions and the relationships required for those definitions are in scope.

## Approval gate

No Production write has been performed.

Before the first Production write, the copy SQL must be prepared as an atomic transaction, validated against the then-current schema/HEAD, and presented for explicit approval.
