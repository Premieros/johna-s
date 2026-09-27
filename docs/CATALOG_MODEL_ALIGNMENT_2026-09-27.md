# CATALOG MODEL ALIGNMENT — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/catalog-model-alignment-20260927`
Current PR: `#389`
Base: `main@a2bd92798a3993d5022b188a47e0f9dfb4c0a96c`
Last updated: 2026-09-27 Africa/Cairo

## Work status

State: **PHASE 0 COMPLETE / PHASE 1 READY**

Goal: align all current user-facing catalog/component flows with the post-PR #388 model so there is one coherent operational concept:
- Products
- Raw materials
- Reusable component groups
- Modifier groups/options
- Kitchen/send resolves canonical raw-material consumption

There must be no user-facing production/manufacturing lifecycle and no competing component-authoring paths.

## Mandatory execution rules

- This file is the source of truth for this workstream.
- Do not rely on conversation memory for execution state.
- Before every write, fetch branch HEAD and require exact expected SHA.
- Unexpected HEAD => STOP_AND_RECONCILE.
- No direct write to `main`; no force push.
- No Production migration before exact-head Full Verify Green + explicit approval.
- Do not touch printing, Print Agent, printer routing, KDS, or send-to-kitchen authority.
- Preserve Permission-First, RLS, branch isolation, and Super Admin implicit bypass only.
- Do not delete historical migrations/tables/RPCs merely for cleanup.
- Open PR #372 overlaps old manufacturing cleanup but is stale/non-mergeable; do not merge/rebase it into this branch.

## Current model definition

User-facing model:
1. A product may consume direct raw materials and/or reusable component groups.
2. A component group is only a named bundle of raw materials/components. It is NOT a production/prebuild workflow.
3. Modifier groups contain reusable options with Min/Max and product assignments.
4. Modifier options may point to component groups.
5. Kitchen/send resolves the canonical raw-material graph and produces the authoritative consumption snapshot.
6. No user-facing production order, manufacture, start/complete production, or production warehouse flow.

Internal compatibility names such as `manufactured`, `recipes`, and legacy RPCs may remain where required for historical/database compatibility, but they must not expose duplicate user-facing workflows or conflicting sources of truth.

## Comprehensive audit findings

### A — Critical: duplicate component-authoring paths

1. `src/features/manufacturing/pages/RecipesPage.tsx`
   - Full independent recipe CRUD.
   - Reads/writes `recipes` and `recipe_items`.
   - Uses `update_recipe_with_items` and `delete_recipe_controlled`.
   - Also edits `product_unit_links`.
   - Result: a separate authoring workflow competing with the current component-group model.

2. `src/features/catalog/pages/ProductSetupWizardPage.tsx`
   - Creates product through current catalog flow.
   - Also directly inserts `recipes` + `recipe_items` when direct raw components are supplied.
   - Also writes component-group links.
   - Result: product creation can produce two representations.

3. `src/features/catalog/pages/ProductsPage.tsx`
   - Reads direct raws from `recipes/recipe_items`.
   - Reads component groups from `product_unit_links`.
   - Still contains `product_components` legacy display/edit path.
   - Result: three possible component representations are visible in one product surface.

### B — Critical: import/export can recreate retired workflows

4. `src/features/import-export/import-executor.ts`
   - `recipes` import creates/updates products as `manufactured`.
   - Directly deletes/inserts `recipe_items`.
   - `production` import creates `production_orders` and `production_in` inventory movements.
   - This can recreate retired manufacturing behavior even if UI pages are removed.

5. `src/features/import-export/export-service.ts`
   - Exports `recipe_items` as a first-class recipes entity.
   - Exposes production export path.

6. `src/features/import-export/entity-configs.ts`
   - Exposes "Recipes & Product Components".
   - Exposes "Production Orders".
   - Uses `manufacturing.view` permission, which no longer belongs to the current user model.

7. `src/features/import-export/types.ts` / `validation-engine.ts`
   - Still model `recipes` and `production` as active import entities.
   - Validation messages auto-create "manufactured" products.
   - `requiredPermission` in entity configs is not enforced by `ImportExportCenterPage`; the page route is only guarded by `settings.manage`.
   - config uses nonexistent `manufacturing.view`, proving this permission metadata is stale and not an active authorization boundary.

### C — High: navigation / permissions / guided workflows

8. `src/app/routes.tsx`
   - `APP_ROUTES.recipes` remains a live screen.
   - `manufacturingCenter` redirects to Recipes.
   - landing-route resolution can send a user to Recipes via `recipes.view`.

9. `src/core/navigation/menu.config.ts`
   - Catalog group still says "الكتالوج والوصفات / Catalog & Recipes".
   - Recipes remains a primary catalog menu item.
   - Component Groups already exists separately, creating conceptual duplication.

10. `src/core/navigation/routes.ts`
    - Keeps `manufacturingCenter`, `recipes`, `production`, and `productionUnits` route constants.
    - Legacy route constants may remain as redirects, but must not remain live workflows.

11. `src/lib/permissionDefs.ts`
    - Active labels/groups still expose recipes.
    - Legacy production permissions are partially marked compatibility-only, which is acceptable internally.
    - Role preset `production_manager` and label "مدير إنتاج / Production Manager" remain user-facing and conflict with retired manufacturing terminology.

12. `src/lib/permissionContracts.ts`
    - `recipes.manage -> recipes.view` and legacy production implications remain.
    - These may remain for compatibility if no live screen depends on them.

13. `src/core/guard/prerequisitesRegistry.ts`
    - Still includes "Create Manufacturing Recipe".
    - Production-create workflow checks warehouse + recipes and routes users to Recipes.
    - This is an active guided path to retired behavior.

14. `src/core/guard/useOperationalGuard.ts`
    - Exposes `guardProduction` using `production.manage`.
    - Must be confirmed dead before removal.

### D — High: reports and closing/costing semantics

15. `src/features/reporting/reportRegistry.ts`
    - category key `manufacturing_costing`.
    - report key `recipe_costs`.
    - report key `production_waste`.
    - Some underlying calculations may remain correct, but user-facing terminology is stale.

16. `src/features/reporting/pages/ReportsPage.tsx`
    - "Recipe Cost" labels remain.
    - `production_waste` remains.
    - canonical `sales_component_reconciliation` already exists and is aligned.

17. `src/features/reporting/reportFilters.ts`, `ReportsCenterPage.tsx`, `reportExcelProfiles.ts`
    - still expose recipe/production report identifiers and labels.
    - IDs may remain internally if required for compatibility, but visible titles should align.

18. `src/features/costing/pages/CostingCenterPage.tsx`
    - separately renders `components` and `recipe_items`.
    - Requires verification against current canonical cost RPC before changing; could be a valid compatibility read rather than a conflict.

19. `src/features/trade/services/shiftClosingReport.ts`
    - contains exported legacy `fetchShiftClosingDetails()` that reconstructs raw consumption from `recipes/recipe_items`.
    - current live shift flows DO NOT consume this helper; `ShiftModal`, `ShiftsPage`, and automatic Z-print use `fetchShiftClosingReportServer()` from `shiftClosingFinancials.ts`.
    - the live adapter gets ingredients from `getRawConsumptionCostBreakdown`, which is ledger/kitchen-send based.
    - therefore this is dead legacy cleanup, not an active shift-report correctness defect.

### E — Medium: terminology and admin/demo surfaces

20. `src/features/catalog/pages/InventoryUnitsPage.tsx`
    - Correct conceptual destination is Component Groups.
    - Still uses recipe wording in state/types/messages such as RecipeRow / "Complete the recipe rows".
    - Needs terminology cleanup after source-of-truth alignment.

21. `src/features/admin/pages/AdminDataManagementPanel.tsx`
    - visible label: "التصنيع والوصفات والمواد الخام / Manufacturing, recipes & raw materials".
    - Must be renamed/re-scoped.

22. `src/lib/i18n.ts`
    - large amount of stale manufacturing/production/recipe UI text remains.
    - Some keys may be dead compatibility; remove only after usage proof.

23. `src/lib/userFacingError.ts`
    - visible permission text "Manage recipes".
    - recipe-specific branch errors remain.
    - Reword where active; leave internal codes intact.

24. `src/lib/comprehensiveDemoSeeder.ts`
    - seeds recipe-based products using `recipes/recipe_items`.
    - Demo data can reintroduce the legacy model and must be aligned or isolated.

### F — Internal compatibility that is NOT automatically a bug

25. Database migrations contain extensive historical:
    - `recipes`, `recipe_items`
    - `production_orders`
    - `manufactured`
    - auto-production compatibility
    - product-unit hierarchy
    - canonical component resolver
    - modifier inventory effects

These migrations are historical/runtime contracts and MUST NOT be deleted merely because names are old.

26. Current canonical DB work includes:
    - `20260922190000_canonical_component_resolver.sql`
    - `20260922203000_kitchen_raw_component_snapshot.sql`
    - modifier-group migrations
    - product-unit link migrations

These are the likely source-of-truth contracts for the final aligned runtime and must be preserved.

27. Tests referencing legacy schema/RPCs are not automatically stale.
    - Integration/security tests can protect backwards compatibility.
    - Only UI/behavior contract tests should be updated when user-facing workflows are retired.

## Risk ranking

P0 — must resolve before calling the model aligned:
- RecipesPage live independent CRUD/workflow
- ProductSetupWizard scattered direct recipe writes (retain direct-raw storage but centralize the mutation boundary)
- ProductsPage must become the single product composition editor even if internal storage remains split by type
- Import recipes direct writes must be aligned to product raw-component semantics
- Production import must be retired/blocked
- Import/export entity permissions must use current real permissions

P1 — must align in same workstream:
- routes/menu/landing behavior
- prerequisite production/recipe workflows
- import/export configuration and validation
- report titles/categories and recipe-cost naming
- admin data-management terminology
- InventoryUnits terminology

P2 — cleanup only after usage proof:
- i18n dead keys
- production_manager preset/label
- legacy route constants
- legacy permission keys
- demo seeder
- unused guardProduction code

## Phase 0 proof

- Canonical product raw resolver: `resolve_product_raw_components(product,branch)`.
- It intentionally combines:
  - latest active `recipes/recipe_items` = direct product raw materials;
  - `product_unit_links` + inventory-unit recipes = reusable component groups.
- Resolver is read-only and does not manufacture/mutate inventory.
- Kitchen send uses `resolve_kitchen_item_raw_components`, then snapshots and deducts flattened raw materials directly.
- Modifier inventory-unit effects are flattened through `resolve_inventory_unit_raw_components`.
- Therefore `recipes/recipe_items` is still a compatibility storage format for DIRECT product raws; it must not be deleted in this workstream.
- The conflict is duplicate user-facing authoring/workflows and direct scattered writes, not the mere existence of the tables.
- Live shift consumption is ledger/kitchen based through `getRawConsumptionCostBreakdown`; the recipe-based helper is unused legacy.
- `sales_component_reconciliation` already compares current canonical components against authoritative ledger consumption and is aligned.
- `create_product` is the canonical product-row + component-group-link creation RPC, but explicitly leaves direct raw recipe wiring outside its transaction. This is the remaining mutation-boundary gap to handle carefully.

## Implementation plan

### Phase 0 — Contract/source-of-truth proof
- Read canonical component resolver, kitchen snapshot authority, catalog create/update RPCs, costing sources, and shift-close sources.
- Add focused tests that distinguish allowed compatibility reads from forbidden new legacy authoring.
- No behavior change before this proof.

### Phase 1 — Stop creating conflicting data
- ProductSetupWizard: remove direct legacy recipe authoring in favor of canonical product/component save path.
- Import/Export: disable/redirect retired production import and align component import with canonical model.
- Add regression tests.

### Phase 2 — Unify product editing
- ProductsPage: one authoritative component editor/read model.
- Preserve historical records as read-compatible where necessary.
- No destructive data rewrite.

### Phase 3 — Retire live recipe/production navigation
- Recipes page becomes redirect/compatibility landing to the canonical component/product editor.
- Remove active menu/landing/prerequisite paths to manufacturing/recipe workflows.
- Keep safe legacy URL redirects.

### Phase 4 — Financial/report correctness
- Verify ShiftClosingReport uses authoritative ledger/snapshot consumption, not recipe reconstruction.
- Align CostingCenter and report labels with canonical component terminology.
- Do not change accounting math without regression evidence.

### Phase 5 — terminology/admin/demo cleanup
- InventoryUnits wording.
- AdminDataManagementPanel wording.
- Active i18n/user-facing errors.
- Demo seeder alignment.
- Permission labels only where safely user-facing.

### Phase 6 — verification
- Focused contracts after each phase.
- Lint/typecheck/unit/build.
- Exact-head Full Verify including DB/schema/integration/security/RLS/browser-smoke.
- Stop before merge unless explicitly approved.

## Change ledger

- Created branch `development/catalog-model-alignment-20260927` from exact `main@a2bd92798a3993d5022b188a47e0f9dfb4c0a96c`.
- Comprehensive read-only audit completed.
- Phase 1A navigation retirement implemented:
  - Recipes removed from live sidebar menu.
  - `/recipes` now compatibility-redirects to Products.
  - manufacturing/production legacy routes redirect to Component Groups.
  - landing route no longer sends users to Recipes.
  - navigation contract test updated to prevent Recipes returning as a live menu destination.
- No DB migration.
- No Production write.
- No printing/KDS changes.

## Verification ledger

- Baseline audit: complete.
- Canonical component authority proof: complete.
- Live shift-consumption authority proof: complete — ledger/kitchen-send based.
- Import/export permission audit: complete — per-entity requiredPermission is currently not enforced; legacy manufacturing.view metadata is stale.
- Focused tests: navigation contract committed; CI pending.
- Full Verify: not started.

## Production gate

State: **BLOCKED**

No Production change is currently planned. Any future DB change requires exact-head Full Verify Green + explicit approval.

## Next action

Phase 0 only:
1. Prove current canonical component authority end-to-end.
2. Prove current shift-close/costing consumption source.
3. Add contract tests preventing new direct recipe/production authoring from current UI/import surfaces.
4. Only then begin Phase 1 implementation.
