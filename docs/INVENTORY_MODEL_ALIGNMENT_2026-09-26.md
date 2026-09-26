# INVENTORY MODEL ALIGNMENT — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/inventory-model-alignment-20260926`
Current PR: #382
Base: `main@a6abe7a60e7f076f9c05222533038a5a1bc7884f`
Last updated: 2026-09-26 Africa/Cairo

## Work status

State: **BLOCKED**

Goal: align the inventory/catalog user surface with the current permanent operating model without interrupting live branch operations.

## Guardrails

- Single Writer only on this branch.
- No direct write to `main`.
- Before every write, verify branch HEAD and current `main`; unexpected movement = STOP_AND_RECONCILE.
- No force push.
- No Production migration in this phase unless a separately reviewed migration becomes strictly necessary, Full Verify is Green, and explicit approval is given.
- No destructive rewrite of historical production/manufacturing data.
- No RLS weakening and no test weakening.
- Printing / Print Agent / printer routing / KDS / send-to-kitchen transport are frozen and out of scope.
- Preserve the already-merged canonical kitchen-send raw/component deduction model.
- Historical production data remains auditable.
- PR #372 is an older isolated manufacturing-retirement draft; do not write to it or merge it implicitly. Reuse only proven concepts after reconciling with latest `main`.

## Baseline

- Base: `main@a6abe7a60e7f076f9c05222533038a5a1bc7884f` (includes merged PR #381).
- Branch created directly from that exact main head.
- Current PR: #382 (Draft).
- Production code path remains unchanged until merge; no Production database write has been performed.
- Transfer Stage-B warehouse-aware raw-material contract already exists on current main and is being consumed, not redefined, by P1.

## Permanent operating model

- Sellable product = a named collection of direct raw components and/or reusable named component groups.
- No pre-manufacturing or finished-product stock is required before sale.
- Kitchen send is the authoritative inventory deduction point.
- Raw-material stock is warehouse-aware operationally via raw batches/FIFO.
- Raw stock may go negative according to current canonical rules.
- Void/refund reverses the exact stored kitchen-send snapshot.
- User-facing stock transfer is raw-material transfer, not finished-product transfer.
- Legacy production history may remain in the database for audit compatibility, but must not drive current UI behavior.

## Root-cause ledger

1. `TransfersPage` still exposes `product | raw_material`, requires a second destination item field, and blocks same-branch raw transfer using obsolete branch-level-stock wording.
2. `InventoryPage` still presents finished-product `inventory` as the main stock surface, including Ready/Component/Manufactured labels.
3. `InventoryBatchesPage` still manages finished-product batches and exposes `production` as a source.
4. `InventoryUnitsPage`, `ProductSetupWizardPage`, and `PricingPage` still use `unit_type='manufactured'` language/filters even though these units now represent reusable component groups.
5. Legacy production application code still exists on current `main` even though old production routes redirect away from it. PR #372 attempted retirement from an older base and is now stale/non-mergeable.
6. Reporting and permissions still contain manufacturing-era labels; reporting is sensitive because recent report rebuilds exist and must be reconciled before writes.

## Verification policy — approved 2026-09-26

User-approved policy: **Feature-first, focused-test, Fast-Verify, Full-Verify only at phase/merge gates**.

Rules:
- Do not wait for Full Verify after every small UI/application commit.
- After each logical change, run the smallest relevant focused unit/contract check first.
- Use typecheck/lint only when the touched surface can affect those contracts.
- Run **Fast Verify** after a cohesive repair group, not after every file/commit.
- Run DB integration / Fresh DB / RLS / Browser Smoke early only when the change actually touches database schema, migration, RLS/security, or a runtime path that requires those gates.
- For UI-only/current-API alignment work, defer DB and Browser Smoke to the phase gate.
- Run **one exact-head Full Verify** after the complete inventory-alignment package is stable and before merge.
- Any Production migration remains separately gated: Full Verify Green + explicit approval.
- Verification failures must be classified as either change-related or gate/infrastructure/contract drift before modifying runtime code.
- Never weaken or delete tests merely to make a gate faster.

Progress continuity rule:
- This file is the authoritative execution log. Do not rely on chat memory.
- Before each new logical write, read the latest **Next action**, **Change ledger**, and **Verification ledger** here.
- After each logical change group, record what changed, exact head/commit when known, what was verified, and the next action.
- If branch HEAD/main changes unexpectedly, STOP_AND_RECONCILE and update this log before continuing.

## Execution phases

### P0 — Safety and contract audit
- Reconcile current `main`, open PRs, and current database/runtime contracts.
- Identify exact UI/API/tests that can be corrected without Production DDL.
- Add regression guards before broad deletion.

### P1 — Raw-material transfer correction
- Make transfer creation raw-material-only in current UI.
- Remove finished-product transfer choice from user-facing flow.
- Replace the confusing duplicate source/destination raw-material fields with one user-facing raw selection.
- Resolve destination identity deterministically and safely.
- Remove the obsolete same-branch prohibition only if current RPC/database contract proves warehouse-aware raw transfer is valid.
- Preserve permissions, branch isolation, approval flow, FIFO costing, audit log, and historical transfers.

### P2 — Inventory surface alignment
- Reframe the primary inventory screen around raw-material warehouse balances.
- Prevent finished-product stock concepts from being presented as current operational truth.
- Align batch/FIFO UI with raw-material batches where safe.
- Do not delete historical finished-product inventory data.

### P3 — Component-group terminology
- Rename manufactured-unit concepts in current UI to reusable component groups.
- Keep underlying legacy schema names temporarily where changing schema would add risk.
- Ensure product setup and pricing use the canonical component resolver/source.

### P4 — Legacy production application retirement
- Reconcile and port only the safe, current-main-compatible subset of PR #372.
- Remove unused production-order/unit-production UI/API from runtime.
- Keep legacy URLs as safe redirects.
- Preserve historical DB objects until separate database-retirement approval.

### P5 — Reports/permissions/tests cleanup
- Reconcile with latest report rebuild before changing report labels/categories.
- Retire production-only application permissions only after caller proof.
- Update tests so they guard the current operating model instead of preserving legacy manufacturing behavior.

## Change ledger

- Created this isolated branch from latest merged `main@a6abe7a60e7f076f9c05222533038a5a1bc7884f`.
- Read-only audit completed before first application change.
- No Production database writes performed.
- No printing/KDS/send-to-kitchen code modified.

### P1 transfer correction — implemented

- `TransfersPage` is now raw-material-only; the finished-product choice and second destination raw selector were removed.
- Cross-branch destination raw identity is resolved internally by exact normalized name + unit identity and fails closed unless exactly one destination definition exists.
- Read-only Production audit before implementation: 803 active raw-material definitions; 802 have exactly one cross-branch name+unit match, 1 has no match, 0 are ambiguous. The unmatched definition remains fail-closed instead of being guessed or auto-created.
- Same-branch raw transfer is now allowed by the UI because the already-applied Stage-B contract is warehouse-aware and patches create/approve transfer to use source/destination warehouse FIFO.
- Transfer preview cost now reads `raw_material_warehouse_inventory` for the selected source warehouse instead of branch-average raw cost.
- Application `createTransfer` typing is narrowed to raw-material lines. Historical database product-transfer compatibility is not deleted or rewritten.
- Regression contract updated to lock raw-only UX, one visible raw selector, deterministic destination resolution, warehouse-aware same-branch behavior, and source-warehouse costing.
- No Production write/migration; no print/KDS/send-to-kitchen code touched.


### P2 primary inventory surface — in progress

- Replaced the primary `InventoryPage` finished-product balance table with the current raw-material stock surface; the page no longer presents `inventory` product stock, ready/component filters, or manufactured badges as current operational truth.
- `RawMaterialBranchStockPanel` now reads `raw_material_warehouse_inventory` and active warehouses, generating one operational row per raw material per warehouse, including zero-balance rows.
- Added an explicit warehouse filter and warehouse column; branch scoping remains permission/RLS driven through accessible branches.
- Minimum-stock status now uses `raw_materials.min_stock`; financial value/cost remains delegated to authoritative FIFO reporting.
- New stock-count creation is now raw-material-only. Historical product-count rows remain readable/editable by legacy code paths for audit compatibility; no historical rows were deleted.
- Stock-count copy now states that counts apply to the selected warehouse and no longer claims raw stock is branch-level.
- No schema/RLS/Production migration was introduced for these P2 UI changes.

### P2 FIFO batch surface — implemented

- `InventoryBatchesPage` now reads `raw_material_batches` as a read-only FIFO lot/history surface.
- Removed the finished-product batch creation workflow and `production` source choice from current user-facing operation.
- Current page shows raw material, warehouse, branch, residual quantity, unit cost, expiry and source.
- Historical `inventory_batches` and legacy RPCs remain untouched for backward/audit compatibility.
- No Production migration or historical data mutation.

### P3/P4 component terminology and runtime retirement — in progress

- User-facing `manufactured` terminology was converted to **Component Groups / مجموعات المكونات** in Inventory Units, Product Setup and Pricing while keeping legacy schema identifiers temporarily.
- Removed the application export for the retired production workflow and deleted unused runtime pages: Production Orders, Manufacturing Center and Unit Production.
- Legacy production/manufacturing routes remain safe redirects to the reusable component-definition screen.
- Updated smoke/navigation/drift/history tests so they no longer require retired production pages.
- Production database objects and historical data remain untouched.

### P5 reporting and active UI terminology — implemented

- Final active-screen sweep found no remaining current-user labels that present manufacturing/production as an active workflow across Recipes, Products, Pricing, Component Groups, Product Setup, Reports, and Waste Center.
- Recipes now says **Component Groups / مجموعات المكونات** instead of manufactured-item wording.
- Waste Center retains historical production-waste visibility but no longer offers `production` as a type for new waste entries.

- Renamed the report-center user-facing category from **Manufacturing & Costing / التصنيع والتكلفة** to **Components & Costing / المكونات والتكلفة** while preserving internal report keys for compatibility.
- Renamed the user-facing `production_waste` report to **Waste Report / تقرير الهالك**; underlying report key/data source remain unchanged.
- Updated component-consumption descriptions to describe sales/runtime raw-material consumption instead of production.
- Updated `ProductsPage` composition copy from manufactured-item language to **component groups**, and clarified that raw-material deduction occurs when the order is sent to the kitchen.
- Updated active i18n labels so the legacy schema value `manufactured` is presented as **With Components / بمكونات**, and `inventoryUnits` is presented as **Component Groups / مجموعات المكونات**.
- No schema/RLS/Production data change; only current runtime labels and descriptions were changed.

## Verification ledger

- Verify Run #2991 / 36246760374 on exact head `158d73ed5b45092d2683980c0a3be3ee5777d06d`: FULL GREEN — worklog, Supabase identity, API contract, lint, typecheck, unit tests, build, DB/schema, integration + security/RLS, and browser smoke all passed.

- Verify Run #2989 / 36246409813: worklog ✅, Supabase identity ✅, API contract ✅, lint ✅, app/test typecheck ✅. Unit suite reached 1127/1128 passed; the only failure was `branchScopedUsersRecipeManufactured.test.ts` still asserting the retired label **Manufactured components / المصنعات داخل الوصفة** after the final Recipes copy cleanup. Build/DB/browser were skipped after the unit failure.
- Updated only that stale test assertion/title to the current **Component groups / مجموعات المكونات** wording while preserving the operational link-contract assertions. No runtime code changed for this fix.

- Verify Run #2986 / 36245615896 on `79dfbd286427e5b6a4bc2d13f7f51e9b5392f5c8`: **FULL GREEN** — worklog ✅, Supabase identity ✅, API contract ✅, lint ✅, app/test typecheck ✅, unit ✅, build ✅, canonical DB migrations/schema ✅, integration + security/RLS ✅, browser smoke ✅.
- After that green baseline, the final active-screen sweep changed only user-facing wording in Recipes and stopped offering **new** `production` waste-type entries while preserving historical `production` rows for display/audit. No schema/RLS/data migration.

- Verify Run #2983 / 36244879006: worklog ✅, Supabase identity ✅, API contract ✅, lint ✅, application/test typecheck ✅. Unit suite reached 1127/1128 passed; the only failure was one stale text assertion in `catalogTerminologyLockContract.test.ts` expecting an older English sentence that no longer exists after the approved wizard copy cleanup. Build/DB/browser did not run after unit failure.
- Performed a targeted test sweep for remaining old `Manufactured Items / Production Orders / Manufacturing Center / Production Waste` assertions before changing runtime again. No additional active test assertions were found beyond the known terminology lock.
- Replaced the stale assertion with the current measurement-unit contract and preserved the stronger negative guards against product-unit fields.
- Permission keys `production.*` remain canonical for DB/backward compatibility, but the current permission UI now labels them explicitly as **legacy compatibility / غير مستخدم حاليًا** and presents the section as **Waste & Legacy Compatibility / الهالك والتوافق القديم**. No RLS or stored role permissions changed.
- Verify Run #2985 / 36245589710 is queued on exact head `7b4139dc5feacfc7346ad7a1e08b55c98634812c`.

- Verify Run #2975 / 36244316244: worklog ✅, Supabase identity ✅, API contract ✅, lint ✅, application/test typecheck ✅. Unit stage failed only on three stale retirement-era tests: one deleted production-domain authority test and two assertions still requiring the old "Manufactured Items / المصنعات" labels. Build/DB/browser did not run after unit failure.
- Reconciled the failures to the approved retirement model: removed the obsolete production completion authority test, updated terminology lock assertions to **Component Groups / مجموعات المكونات**, and renamed the sidebar item accordingly. No runtime database or Production changes were made for these test fixes.

- Verify Run #2973 / 36243989021: mandatory worklog ✅ and Supabase identity ✅; stopped only at frontend API contract after retiring the production application domain. The stale contract still referenced `create/start/complete/cancel_production_order` and `inventory_unit_productions`; lint/type/unit/build were not executed.
- Refreshed `supabase/api-contract.json` to remove only those no-longer-referenced application RPC/table entries. No database migration, Production mutation, or historical production data deletion was performed.

- Browser Smoke Run #2959 / 36243150093: verify ✅, DB/integration/RLS ✅, browser 115/116 passed; one inventory E2E failed because its mock still served branch-level `raw_material_inventory` and old row test IDs after P2 became warehouse-aware. Classified as stale test fixture, not runtime regression.
- Updated `tests/e2e/inventory-raw-materials.spec.ts` to provide an explicit warehouse, serve `raw_material_warehouse_inventory`, and assert the warehouse-specific row identity. No runtime code was changed for this failure.

- Verify Run #2947 / 36241538524: failed only at mandatory worklog structure because the new log lacked the required `## Baseline` heading; no application checks ran.
- Added the required worklog structure and reran.
- Verify Run #2948 / 36241797865: mandatory worklog gate ✅ and Supabase identity ✅; stopped at frontend API contract because P1 intentionally replaced frontend `inventory_batches` usage with `raw_material_warehouse_inventory`.
- Refreshed `supabase/api-contract.json` to match the current P1 frontend source set only; no database schema or Production data changed.
- Exact-head Full Verify is rerunning on the refreshed contract before P2 writes.

## Production gate

State: **BLOCKED**

- No Production migration authorized.
- No Production data mutation authorized.
- Merge blocked until exact-head Full Verify Green and explicit approval.

## Next action

Observe the exact-current-head verification after the final stale-test correction. No further runtime changes are planned. If verify, DB/integration/RLS, and browser smoke are all green on the final head, record the merge-ready state and stop before merge pending explicit approval.

## Mandatory update protocol

- Before every repository write, verify current branch HEAD and current `main`.
- Unexpected branch or main movement = STOP_AND_RECONCILE before continuing.
- Update `Change ledger` after each logical change group.
- Update `Verification ledger` after every focused or full verification run with the real result and Run ID.
- Keep `docs/CURRENT_WORK_PLAN.md` pointing to this log while PR #382 is the active scope.
- Do not merge or apply any Production migration until exact-head Full Verify is Green and explicit approval is recorded.
