# Manufacturing Retirement Master Plan

Updated: 2026-09-22
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
Status: IN PROGRESS
Branch: development/retire-manufacturing-phase1-pos-runtime-20260922

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

### Phase 2 — Canonical component graph
Status: PENDING

Goal:
- define one canonical composition model for products and reusable named component groups;
- remove semantic distinction between recipe-as-production and product components;
- support nested named groups safely;
- define cycle detection and branch isolation;
- preserve existing data with a migration/compatibility bridge.

Exit criteria:
- one authoritative resolver can flatten a product to raw-material quantities;
- no production order is required to resolve sale consumption;
- existing product/recipe definitions are migrated or bridged losslessly.

### Phase 3 — Exact kitchen-send consumption snapshot
Status: PENDING

Goal:
- send_to_kitchen resolves component graph once;
- aggregate repeated raw materials;
- deduct in one transaction, allowing negative stock;
- persist an immutable per-send/per-line consumption snapshot.

Exit criteria:
- every sent item has an auditable raw/component snapshot;
- no auto-production is invoked by kitchen send;
- FIFO/cost ledger remains correct.

### Phase 4 — Void/refund reversal from snapshot
Status: PENDING

Goal:
- void sent item and refund restore the exact stored snapshot;
- no attempt to reconstruct historical recipe state;
- remove AUTO_SALE_PRODUCTION reversal dependency from new transactions.

Exit criteria:
- send -> void and send -> sale -> refund return exact quantities/costs;
- historical auto-production transactions still remain reversible through compatibility logic.

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
