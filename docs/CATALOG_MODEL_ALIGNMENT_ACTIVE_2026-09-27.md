# CATALOG MODEL ALIGNMENT — ACTIVE EXECUTION LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/catalog-model-alignment-20260927`
Current PR: `#389`
Last updated: 2026-09-27 Africa/Cairo

## Work status

State: **BLOCKED**

Progress: Phase 0 audit complete; Phase 1 implementation in progress.

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
- No DB migration.
- No Production write.
- No printing/KDS changes.

## Verification ledger

- Audit complete.
- Canonical component authority proof complete.
- Shift consumption authority proof complete.
- Verify run #3059 / run `36314730728`: failed only at mandatory active-worklog structure before lint/typecheck/unit/build.
- Runtime/code verification on current implementation head: pending.

## Production gate

State: **BLOCKED**

No Production mutation is allowed in this phase.

## Next action

1. Point `docs/CURRENT_WORK_PLAN.md` to this active execution log.
2. Re-run Verify to expose actual code/test failures.
3. Before permanently removing the old Recipes editor, add a safe direct-raw editing path in the canonical product surface.
4. Continue import/export and terminology alignment only after focused tests pass.
5. Stop before merge until exact-head Full Verify Green and explicit approval.

## Mandatory update protocol

- Before every repository write, fetch branch HEAD and require the exact expected checkpoint.
- Unexpected HEAD movement = STOP_AND_RECONCILE.
- Update Change ledger after each logical implementation group.
- Update Verification ledger after every CI run with actual result and Run ID.
- Keep `docs/CURRENT_WORK_PLAN.md` pointing to this file while PR #389 is active.
- No merge or Production migration until exact-head Full Verify is Green and explicit approval is recorded.
