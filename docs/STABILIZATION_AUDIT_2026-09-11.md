# Stabilization Audit — 2026-09-11

> Evidence log only. `docs/CURRENT_WORK_PLAN.md` remains the single Source of Truth.

## Locked identity

- Repository: `Premieros/johna-s`
- Baseline: `main@93f72e50bf1ad2457cac9cc6b5d513a5c2f5ee6e`
- Working branch: `development/stabilization-cleanup`
- Production Supabase: `azzdesuowpdcoflmyezn`
- No direct writes to `main`.
- No Production DDL/migration during diagnosis.
- No RLS/test weakening.

## Why this phase exists

Manual production usage after PR #64 exposed regressions that the current CI/browser smoke suite did not catch:

1. Inventory screen does not reliably expose raw materials.
2. Dining tables appear missing.
3. Many mobile buttons/actions are not usable.
4. Product edit shows operational composition but does not provide a safe edit path for recipe/manufactured-unit composition.
5. Super Admin cannot complete login in the reported real flow.

Cleanup is therefore gated behind stabilization. Nothing is deleted merely because it looks old or unused.

## Read-only Production snapshot

Read-only inspection found:

- 1 active Super Admin profile, linked to an Auth identity.
- 2 active branches.
- 1 dining table total and 0 dining areas total.
- 199 active raw materials, but only 5 `raw_material_inventory` balance rows.
- 250 active products.
- 12 active manufactured inventory units.
- 55 `product_unit_links` rows.
- 0 `product_components` rows.
- 250 active recipes.

This means several reported symptoms are not simple rendering bugs. The application currently has multiple composition/storage contracts and some production datasets are sparse or absent.

## Confirmed code-contract mismatches

### Inventory / raw materials

`InventoryPage` reads product inventory from `inventory` and appends raw materials through `RawMaterialBranchStockPanel`.

The raw-material panel reads only `raw_material_inventory` rows and requires a selected branch when `useBranchFilter()` returns `null`. With multi-branch access, `null` now intentionally means all accessible branches. The panel therefore can start empty and, even after branch selection, can show only raw materials that already have a balance row. Raw materials with no balance row disappear from the inventory view.

Required correction:

- Treat the raw-material catalog as the source of rows and balance rows as optional quantities.
- Scope explicitly to accessible/selected branches.
- Show zero-balance raw materials instead of hiding them.
- Add regression tests for single-branch, multi-branch and Super Admin branch selection.

### Dining tables

Production currently contains only one dining table and no dining areas. UI work alone cannot recreate historical table data safely.

`ActiveOrdersPage` also has its own branch fallback logic (`selectedBranch || branchFilter || user.branch_id`) rather than using one canonical branch-selection contract. This can produce a different effective branch from the rest of the shell.

Required correction:

- Unify table/floor-plan branch selection with the canonical active-branch selector.
- Add a clear empty-state distinguishing “no branch selected” from “branch has no tables”.
- Never auto-create tables during cleanup.
- Determine separately whether historical tables need approved data restoration.

### Product composition

Production has 0 `product_components` rows but has active recipes, manufactured inventory units and product-unit links.

`ProductsPage` loads recipes and `product_unit_links` into an “Operational composition” panel, but that panel is display-only. The save path persists product fields, sales units and the legacy `product_components` collection; it does not persist edits to recipe ingredients or linked manufactured units.

Required correction:

- Define one canonical editable composition workflow.
- Product edit must show the linked manufactured units/recipe and provide a permission-safe edit path.
- Do not silently migrate composition into `product_components`.
- Add round-trip tests: open product -> view composition -> edit -> save -> reload -> same composition.

### Super Admin login

Production has one active Super Admin application profile linked to `auth.users`, so the reported login failure is not explained by a missing profile alone.

`AuthContext` authenticates through Supabase Auth, then immediately requires a readable active row in `public.users`; otherwise it signs the Auth session back out. The `users` SELECT policy allows a user to read their own profile, so the next checks must cover credentials/login mode, the `get_login_email` username path, lock/rate-limit state, and actual browser error handling.

Required correction:

- Add a real Super Admin authentication regression test against a non-production test identity/fixture.
- Preserve Super Admin as the only implicit bypass.
- Never synthesize a Super Admin profile client-side.

### RLS drift found during audit

Production currently has overlapping `raw_materials` SELECT policies, including an authenticated policy whose predicate is `true` and an older branch-isolated policy. This must be reviewed as a security regression because permissive RLS policies can widen effective access.

Required correction:

- Build a migration only after a Fresh DB + integration/security test proves canonical branch isolation.
- Do not apply it to Production until the entire stabilization branch is Full Green and explicitly approved.

## Safe cleanup rules

A file/module/table/migration path may be removed only when all of the following are true:

1. No runtime route/import references it.
2. No tests/CI scripts depend on it.
3. No migration/schema/RPC contract depends on it.
4. It is not part of a fallback/offline/print path.
5. A replacement is already verified where applicable.
6. Full verification stays green after removal.

### Do not delete yet

- `src/v2` merely because newer feature pages exist.
- legacy composition code while production data still spans recipes, inventory units and product-unit links.
- old migrations that are part of canonical Fresh DB history.
- permission aliases/contracts before schema/tests confirm they are unused.
- old development branches as a substitute for code cleanup.

## Execution order

1. Add regression coverage for the five reported failures.
2. Fix Super Admin login path and mobile action usability first because they block administration/use.
3. Fix canonical branch selection for floor plan and inventory raw materials.
4. Fix product composition view/edit round-trip.
5. Run lint, typecheck, unit, build, Fresh DB/schema, integration/security/RLS and Browser Smoke including mobile viewport coverage.
6. Only then run dead-code/import/route audit and remove proven-unused code in small commits.
7. Re-run the full suite after every cleanup batch.
8. Open a PR to `main`; no merge until green and reviewed.

## Definition of done

- Super Admin can sign in and reach Super Admin console.
- Raw materials appear in inventory even when their balance is zero, within branch scope.
- Floor plan shows existing tables for the selected branch and an accurate empty state otherwise.
- Product edit exposes real manufactured/recipe composition and edits survive reload.
- Core buttons are clickable at common mobile widths and no overlay intercepts interaction.
- Permission-First behavior and branch RLS remain intact.
- No Production data is silently recreated/deleted.
- Cleanup removes only evidence-backed dead code.
- Final branch is Full Green before any merge or Production migration.