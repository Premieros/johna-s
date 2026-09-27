# CATALOG MODEL ALIGNMENT — ACTIVE EXECUTION LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/catalog-model-alignment-20260927`
Current PR: `#389`
Last updated: 2026-09-27 Africa/Cairo

## Work status

State: **READY_FOR_REVIEW**

Progress: Comprehensive audit and alignment implementation complete; awaiting final exact-head verification of this documentation commit before merge review.

Detailed audit and findings:
`docs/CATALOG_MODEL_ALIGNMENT_2026-09-27.md`

## Guardrails

- This file is the mandatory execution log.
- Do not rely on conversation memory.
- Before every write, fetch branch HEAD and require exact expected SHA.
- Unexpected HEAD = STOP_AND_RECONCILE.
- No direct write to `main`; no force push.
- No Production migration without exact-head Full Verify Green + explicit approval.
- Do not touch printing, Print Agent, routing, KDS, or send-to-kitchen authority.
- Preserve Permission-First, RLS, branch isolation, and Super Admin implicit bypass.
- Historical migrations/tables/RPCs are compatibility assets and are not deleted for naming cleanup.
- PR #372 is stale/overlapping and must not be merged into this workstream.

## Baseline

- Base: `main@a2bd92798a3993d5022b188a47e0f9dfb4c0a96c`.
- PR #388 modifier simplification is included.
- Canonical raw-component resolver and kitchen snapshot authority are already on main.
- Live shift consumption uses ledger/kitchen-send costing.
- Direct product raws are stored internally in `recipes/recipe_items`.
- Reusable component groups are stored via `product_unit_links`.
- No Production write has been performed by PR #389.

## Root-cause ledger

1. RecipesPage remains a duplicate authoring surface for direct raws/component links.
2. ProductSetupWizard writes direct raw rows outside the catalog create RPC.
3. ProductsPage shows direct raws but does not persist edits to them.
4. Import/export can surface retired Production Orders behavior.
5. Import entity permission metadata includes stale/non-canonical permissions and is not enforced per entity by the page.
6. Navigation/guard/report/admin terminology still contains active recipe/manufacturing wording.
7. Legacy recipe-based shift reconstruction exists but has no live consumers; it is cleanup, not an active financial defect.

## Change ledger

- Created branch from exact latest main.
- Opened Draft PR #389.
- Completed comprehensive read-only audit.
- Retired Recipes from live sidebar navigation.
- `/recipes` now redirects to Products.
- Legacy manufacturing/production URLs redirect to Component Groups.
- Landing route no longer sends users to Recipes.
- Retired Production Orders from visible import/export entity configs.
- Renamed visible Recipes import surface to Direct Product Raw Materials.
- Changed related import permission metadata away from `manufacturing.view`.
- Added `catalogModelAlignmentContract.test.ts`.
- Added one Catalog API boundary for direct product raw-material read/write.
- ProductSetupWizard now uses the Catalog API boundary instead of direct recipe writes.
- ProductsPage is now the direct-raw editor as well as the component-group editor.
- Removed dead guided-workflow actions for retired production/recipe creation.
- Reworded user-facing recipe/manufacturing terminology in permissions, admin data management, component groups, and cost reports.
- Removed `production` from import/export entity types and runtime executor/export paths.
- Direct-raw import now requires existing products/raw materials and writes through Catalog API; it no longer auto-creates production-style data.
- No DB migration.
- No Production write.
- No printing/KDS changes.

## Verification ledger

- Audit complete.
- Canonical component authority proof complete.
- Shift consumption authority proof complete.
- Verify run #3059 / run `36314730728`: failed only at mandatory active-worklog structure before lint/typecheck/unit/build.
- Verify #3066 / run `36319679754`: lint ✅, typecheck ✅, test-suite typecheck ✅, 1147 unit tests ✅, build ✅, canonical migrations/schema ✅, integration + security/RLS ✅; browser-smoke was still running when later code changes continued.
- Verify #3081 / run `36320695960` on implementation head `5f05dcdfd0772d9fcbb1180cdeee511f856a2d1d`: Full Green ✅ — worklog, Supabase identity, API contract, lint, typecheck, application/test typecheck, 1148 unit tests, build, canonical migrations/schema, integration + security/RLS, and Playwright browser-smoke all passed.

## Production gate

State: **NO_DB_MIGRATION_REQUIRED**

This PR contains no Production migration and no Production database write.

## Next action

1. Run exact-head Verify for this final documentation head.
2. Reconfirm PR mergeability and latest `main` drift.
3. Stop before merge and wait for explicit approval.

## Mandatory update protocol

- Before every repository write, fetch branch HEAD and require the exact expected checkpoint.
- Unexpected HEAD movement = STOP_AND_RECONCILE.
- Update Change ledger after each logical implementation group.
- Update Verification ledger after every CI run with actual result and Run ID.
- Keep `docs/CURRENT_WORK_PLAN.md` pointing to this file while PR #389 is active.
- No merge or Production migration until exact-head Full Verify is Green and explicit approval is recorded.
