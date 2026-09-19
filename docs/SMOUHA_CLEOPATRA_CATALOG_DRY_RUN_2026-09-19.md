# Smouha → Cleopatra Catalog Copy — Dry Run + Execution Record

Date: 2026-09-19

## Safety boundary

This branch contains planning, diagnostics, and the execution record only.

- Repository: `Premieros/johna-s`
- Work branch: `development/smouha-cleopatra-catalog-dry-run-20260919`
- Initial base: `main@ffdc8259b8c10bd355b0be50a1055d4ddeb5abd8`
- Latest main observed immediately before execution: `89d8024bfc26d98e7f59667f8800798abfc61ff8` (PR #236 merged)
- Production project: `azzdesuowpdcoflmyezn`
- No migration was applied.
- No changes were made to printer stations, Print Agent, print queues, send_to_kitchen, KDS, shifts, business-day close, sales, purchases, stock balances or financial history.
- No files from the concurrent PR #236 workstream were modified.

## Branch identities

- Smouha: `19c3fd23-d784-455b-8840-f4f2ac619651`
- Cleopatra: `279e6662-e901-40b2-9170-7dda0b471ba7`

## Approved dry-run snapshot

| Entity | Smouha before | Cleopatra before |
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

Modifier dependencies in Smouha:

- Modifier groups: 4
- Modifier options: 8
- Product/group links: 21
- Modifier inventory effects: 12

## Constraints discovered before execution

1. `raw_materials.code` is globally unique, not branch-scoped.
2. `inventory_units.code` is globally unique, not branch-scoped.
3. Destination code rule used: `CLP-<source_code>`.
4. Pre-write collision check: 0 raw-material code collisions and 0 inventory-unit code collisions.
5. All 26 source categories reference source kitchen stations.
6. Cleopatra already had active matching station codes (`kit`, `بار`, `كاش`).
7. Source station IDs were never copied; category station references were mapped to the already-existing Cleopatra stations by code.

## Source integrity before execution

The approved preflight found:

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
- Inactive raw materials referenced by active recipes: 0
- Missing measurement-unit references: 0

One active source product had no category:

- `Ice Mocha Latte` — source id `fe4a8dbb-77ef-4c9e-9370-6fb3ce9e28a5`

It was intentionally cloned with `category_id = NULL`; no silent correction was made.

## Production execution

User approval was received before the first Production write.

Execution properties:

- One atomic transaction.
- Isolation: `REPEATABLE READ`.
- Short `lock_timeout` to avoid waiting on / disrupting live work.
- Pre-write fail-closed assertions for exact source counts, empty destination, code collisions, station mapping, and recipe/raw-material validity.
- New UUIDs for all cloned branch-owned rows.
- No source-row UPDATE or DELETE.
- No table-wide locks were requested.
- All post-copy relationship and count assertions were executed before `COMMIT`.
- Any failed assertion would have aborted the transaction.

The transaction completed and returned `status = committed`.

## Production result after commit

| Entity | Smouha after | Cleopatra after |
|---|---:|---:|
| Categories | 26 | 26 |
| Raw materials | 401 | 401 |
| Inventory/manufactured units | 17 | 17 |
| Products | 254 | 254 |
| Recipes | 254 | 254 |
| Recipe items | 1080 | 1080 |
| Inventory-unit raw-material recipe rows | — | 68 |
| Inventory-unit component-unit rows | — | 3 |
| Product → inventory-unit links | — | 55 |
| Modifier groups | — | 4 |
| Modifier options | — | 8 |
| Modifier product links | — | 21 |
| Modifier inventory effects | — | 12 |

Source catalog counts remained unchanged after the transaction.

## Post-commit branch-isolation verification

All of the following returned zero violations for Cleopatra:

- Category → kitchen station cross-branch
- Product → category cross-branch
- Recipe → product cross-branch
- Recipe item → raw material cross-branch
- Product → inventory unit cross-branch
- Inventory-unit recipe → raw material cross-branch
- Inventory-unit recipe → component unit cross-branch
- Modifier group/product cross-branch
- Modifier inventory-effect target cross-branch

Code verification:

- Cleopatra raw materials without `CLP-` prefix: 0
- Cleopatra inventory units without `CLP-` prefix: 0

## Operational tables explicitly verified untouched for Cleopatra

Post-commit counts remained zero for the copied catalog in:

- `raw_material_inventory`
- `raw_material_batches`
- `inventory_unit_batches`
- `inventory_unit_entries`
- `inventory_unit_productions`

The operation did not create stock, batches, production rows, purchases, sales, movements, shifts, business days, or financial history.

## Printing / stations

Existing Cleopatra stations were reused only as foreign-key targets for the cloned category definitions.

No station row was inserted, updated, or deleted. No Print Agent, print queue, printer routing, send-to-kitchen, or KDS implementation was changed.

## Explicit exclusions

The copy did not include:

- warehouse stock or balances
- raw-material inventory balances
- batches
- purchases
- inventory movements / ledger history
- sales / orders / payments
- expenses
- shifts / business days
- customer/supplier balances
- printer stations or Print Agent configuration
- historical costing transactions

Only catalog/master definitions and their required catalog relationships were copied.
