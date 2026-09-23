# Manufacturing Retirement Master Plan

Updated: 2026-09-23
Repository: Premieros/johna-s
Production branch: main
Production Supabase: azzdesuowpdcoflmyezn

## Permanent operating model

This file is the Source of Truth for removing manufacturing/production concepts without disrupting live branches.

Business rules:
- A sellable product is a named collection of components.
- A reusable recipe/group is only a named collection of raw materials/components.
- There is no requirement to manufacture or pre-build stock before sale.
- POS must not run stock/recipe availability scans to decide whether a product may be sold.
- Kitchen send is the authoritative inventory deduction point.
- Raw-material inventory is allowed to go negative.
- If a sold product has no configured raw/components, kitchen send must create/reuse a branch-scoped fallback raw material with the same product name and deduct the sold quantity from it; its balance may become negative.
- Void/refund must reverse the exact components that were originally deducted.
- Historical transactions must remain auditable.
- Printing, print agents, routing, and receipt templates are outside this program unless explicitly requested.
- Live branches and users must remain operational throughout migration.

## Delivery discipline

Each phase:
1. starts from current main;
2. works on its own development branch;
3. updates this file;
4. adds/updates regression tests;
5. requires Full Verify green;
6. merges to main only after the phase is complete;
7. production migrations remain separate and require explicit approval before application.

Do not delete historical production data before a compatibility/archival phase proves it is safe.

## Phase status

### Phase 1 — POS runtime decoupling
Status: COMPLETE — verified green on run #2355
Branch: development/retire-manufacturing-phase1-pos-runtime-20260922
PR: #326

Goal:
- remove catalog-wide stock/sellability preflight from POS startup;
- remove POS startup recipe/component scan;
- keep only operational gates: branch, shift, permission;
- keep kitchen send as server-owned deduction point;
- reduce outbound queries immediately without changing kitchen deduction/printing.

Implementation:
- removed get_pos_product_sellability call from PosWorkspacePage;
- removed product_components load from POS startup;
- removed client-side availability/configuration gating from ProductBrowser;
- stopped restoring cached stock/sellability maps into POS runtime;
- kept legacy database availability functions untouched for compatibility until later phases.

Exit criteria:
- lint/typecheck/unit/build green;
- DB/integration/security green;
- browser smoke green;
- POS can open without sellability/recipe scans;
- no printing code changed.

Verification:
- Verify main #2354 ✅
- Verify main #2355 ✅
- No production migration required for Phase 1.

Completion note:
- POS no longer calls catalog-wide sellability/availability RPCs on startup;
- POS no longer loads product_components recipes on startup;
- ProductBrowser gates only on branch/shift/permission;
- legacy DB compatibility functions remain for later retirement phases.

### Phase 2 — Canonical component graph
Status: COMPLETED
Branch: development/retire-manufacturing-phase2-components-20260922
Base: main@7bb0009409ce69410cb0cc4d6b9a17910fd33b85

Goal:
- define one canonical composition model for products and reusable named component groups;
- remove semantic distinction between recipe-as-production and product components;
- support nested named groups safely;
- define cycle detection and branch isolation;
- preserve existing data with a migration/compatibility bridge.

Production read-only audit before implementation:
- products: 508;
- legacy recipes: 508, recipe_items: 2160;
- product_components: 0 rows (not an operational composition source);
- inventory_units: 34;
- product_unit_links: 110;
- inventory_unit_recipes: 136;
- inventory_unit_recipe_units: 6;
- 502 products currently have direct legacy raw recipe rows;
- 110 products have reusable inventory-unit raw groups;
- 104 products use both paths and therefore require deterministic combined handling;
- 110/110 current group links have no same-name raw placeholder in the product recipe, confirming that name-based suppression is not a valid canonical rule.

Canonical Phase-2 interpretation:
- `recipes/recipe_items` = direct raw components of a product;
- `inventory_units` linked through `product_unit_links` = reusable named component groups (legacy physical name retained only for compatibility);
- `inventory_unit_recipes` = raw members of those groups;
- `inventory_unit_recipe_units` = nested named groups;
- `product_components` is not used as a canonical source because Production currently has zero rows.

Implementation:
- adds internal `resolve_product_raw_components(product_id, branch_id)`;
- resolver recursively flattens reusable/nested groups directly to raw-material quantities;
- removes name-based composition inference: Production audit found 0 same-name placeholder matches across all 110 current group links, so every explicit direct raw and every explicit group link contributes deterministically;
- includes nested group wastage exactly as the old production consumption did;
- does not create production orders, inventory batches, or stock movements;
- rejects cross-branch groups/raws and detects cycles.

Exit criteria:
- one authoritative resolver can flatten a product to raw-material quantities;
- no production order is required to resolve sale consumption;
- existing product/recipe definitions are migrated or bridged losslessly;
- integration proves direct + reusable + nested composition and zero production side effects.

Verification:
- Verify main #2366 ✅
- lint/typecheck/unit/build ✅
- Fresh DB/schema ✅
- integration + security/RLS ✅
- browser-smoke ✅
- No Phase-2 migration applied to Production; production apply remains blocked until explicit approval.

### Phase 3 — Exact kitchen-send consumption snapshot
Status: COMPLETED
Branch: development/retire-manufacturing-phase3-clean-recovery-20260922
Base: main@d036a963bf5681b52cc037abd1d583f38af701e9
PR: #330
Recovery note: previous Phase-3 PR #329 was closed without merge after scope contamination; this branch was rebuilt cleanly and verified.

Goal:
- send_to_kitchen resolves component graph once;
- aggregate repeated raw materials;
- deduct in one transaction, allowing negative stock;
- persist an immutable per-send/per-line consumption snapshot.

Implementation:
- internal kitchen-send path deducts canonical raw materials directly;
- no auto-production is invoked for new kitchen sends;
- new kitchen inventory events persist component_snapshot with snapshot_version=2;
- unconfigured products create/reuse a same-name branch-scoped fallback raw and deduct directly from it;
- raw stock may become negative;
- integration fixtures were migrated from inventory-unit stock assertions to raw-material assertions where kitchen-send semantics changed.

Exit criteria:
- every sent item has an auditable raw/component snapshot;
- no auto-production is invoked by kitchen send;
- FIFO/cost ledger remains correct.

Verification:
- Verify main #2405 ✅
- lint/typecheck/unit/build ✅
- Fresh DB/schema ✅
- integration + security/RLS 810/810 ✅
- browser-smoke ✅
- Production migration remains unapplied pending explicit approval.

### Phase 4 — Void/refund reversal from snapshot
Status: COMPLETED
Branch: development/retire-manufacturing-phase4-snapshot-reversal-20260923
Base: main@fb8ee6ecb004accd437ac5a0b29d47abeedf4228

Goal:
- void sent item and refund restore the exact stored snapshot;
- no attempt to reconstruct historical recipe state;
- remove AUTO_SALE_PRODUCTION reversal dependency from new transactions.

Exit criteria:
- send -> void and send -> sale -> refund return exact quantities/costs;
- historical auto-production transactions still remain reversible through compatibility logic.

Implementation intent:
- snapshot_version=2 voids restore raw materials directly from component_snapshot;
- all-v2 settled sale-item refunds restore from the same immutable snapshots;
- current recipe changes after send must not affect reversal;
- mixed/legacy transactions keep the existing effects/source-reversal compatibility path;
- no printing, station routing, or UI changes.

Verification:
- Verify main #2408 ✅
- lint/typecheck/unit/build ✅
- Fresh DB/schema ✅
- integration + security/RLS ✅
- browser-smoke ✅
- Production migration remains unapplied pending explicit approval.

### Phase 5 — Retire production UI/API/workflows
Status: PENDING

Goal:
- remove ProductionOrdersPage and production workflow navigation;
- remove create/start/complete/cancel production application API;
- remove production import/export workflow;
- retire production-only permissions and UI wording;
- rename recipe concepts to reusable component/raw groups in the UI.

Exit criteria:
- no user-facing manufacturing/production workflow remains;
- sell/purchase/inventory/costing/reporting continue green.

### Phase 6 — Database retirement and historical compatibility
Status: PENDING

Goal:
- inventory all production-only tables/functions/triggers/policies/indexes;
- block new writes first;
- archive/preserve historical records needed for audit;
- drop obsolete runtime functions/tables only after proving no live dependency.

Candidates include:
- production_orders
- production_waste
- inventory_unit_productions where production-only
- produce_inventory_unit
- _produce_inventory_unit_internal
- _ensure_inventory_unit_stock auto-production branch
- AUTO_SALE_PRODUCTION-specific runtime paths
- production-only RLS/policies/indexes

Exit criteria:
- dependency scan finds no application/runtime caller;
- fresh DB and production schema contracts pass without obsolete definitions;
- explicit production migration approval obtained before apply.

### Phase 7 — Fast Data V2
Status: PENDING

Goal:
- all large administrative lists: 50-row server pages + automatic load-more;
- no exact count on first paint where not required;
- server search across the full dataset with debounce/cancellation;
- details loaded on demand;
- shared slow-changing cache;
- POS catalog cache/delta sync and local search;
- reports use aggregate RPCs instead of many small queries.

Exit criteria:
- page first paint is bounded and immediate;
- POS startup does not require full stock/product availability scans;
- outbound query count and payload size are materially reduced.

## Known dependency areas to clean in later phases

Application:
- src/features/manufacturing/pages/ProductionOrdersPage.tsx
- src/features/manufacturing/pages/ManufacturingCenterPage.tsx
- src/api/domains/manufacturing.ts
- src/api/domains/catalog.ts production helpers
- src/features/import-export/import-executor.ts
- ProductSetupWizard manufacturing terminology/paths
- production capability/navigation/permission definitions

Database/runtime:
- production_orders / production_waste
- recipes / recipe_items semantics
- product_components legacy BOM
- inventory unit production helpers
- AUTO_SALE_PRODUCTION
- sellability/configuration functions coupled to manufacturing
- refund/void compatibility paths
- schema verification expectations

Tests/docs:
- auto-production availability/reversal tests
- produce_inventory_unit security tests
- nested manufactured unit tests
- production variance tests
- schema/codemap/dependency documentation

## Safety locks

- Never touch print agents/templates/routing in these phases.
- No direct main edits.
- No force push.
- No RLS weakening.
- Super Admin remains the only implicit bypass.
- Branch isolation remains mandatory.
- No production migration before Full Verify green + explicit approval.
- Historical rows are preserved until a dedicated retirement phase.
