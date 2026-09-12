# Stabilization Work Log

Date: 2026-09-11
Repository: `Premieros/johna-s`
Working branch: `development/stabilization-phase-2`
Production branch: `main` (read-only during stabilization)
Production Supabase: `azzdesuowpdcoflmyezn`

## Execution protocol

- `docs/CURRENT_WORK_PLAN.md` remains the Source of Truth.
- Work proceeds one stage at a time.
- Each stage is tracked as `IN PROGRESS`, `VERIFIED`, or `BLOCKED`.
- Every stage records what was done, verification/tests, remaining work, and evidence.
- The next stage MUST NOT start until the user writes `تم` after the current stage report.
- No direct writes to `main`, no force push, no weakening RLS/tests, no role-name authorization. Super Admin is the only implicit bypass.
- Do not touch other repositories or databases.

## Stage 1 — Purchase Requests Permission Stabilization

Status: **VERIFIED**
Route reference: `#/purchases/requests`
Verified code/documentation head before closure-only log commit: `fe81c38ac7508e5993541a61e87824dd036378f8`
Verification workflow: **Verify main #1076 — Full Green**
Draft PR: **#68 — remains unmerged**

### Goal
Align Purchase Request creation with the canonical Permission-First contract without changing unrelated procurement behavior.

### Confirmed deviation and closure

| Area | Expected contract | Previous implementation | Stage 1 result |
| --- | --- | --- | --- |
| Purchase Request creation UI | `procurement.request.create` | `purchases.manage` | VERIFIED FIXED |
| `create_purchase_request` RPC | `procurement.request.create` | legacy `purchases.manage` gate | VERIFIED FIXED |
| Submit / Cancel transitions | Verify exact backend contract before changing UI | `purchases.manage` in UI | intentionally deferred; not modified |
| Approve / Reject transitions | Verify exact backend/approval contract before changing UI | `purchases.manage` in UI | intentionally deferred; not modified |
| RFQ creation | `purchases.rfq` | `purchases.rfq` | unchanged |

### Stage 1 evidence

- `src/features/trade/pages/PurchaseRequestsPage.tsx`: Create capability aligned to `procurement.request.create`.
- `src/lib/permissionDefs.ts`: canonical permission exists.
- `src/api/domains/procurement.ts`: creation calls `create_purchase_request`.
- Added permanent regression coverage for explicit create permission and branch isolation.
- Legacy procurement fixture was corrected only inside its transaction; Runtime Authorization/RLS were not weakened.
- Verify main #1076: **FULL GREEN**.
- Production Supabase was not modified.

### Remaining after Stage 1

- No Stage 1 code/test work remains.
- PR #68 remains Draft/unmerged.
- User wrote `تم`; transition to Root Stage B was authorized.

## ROOT STAGE B — Inventory / Ledger / Availability

Status: **VERIFIED**
Start head: `c34a7803e559bdc1ab5f8d85546b0fa684c9f124`
Verified code/test head: `4744e217c2e4b19a1ea5f75b1da3dd9cc90e2326`
Verification workflow: **Verify main #1090 — FULL GREEN**
Production `main` baseline during verification: `c462b2014671ed6a4cc003006c8ad87bf848cd21`
Production Supabase writes: **NONE**

### Goal
Stabilize and prove the shared inventory contract:

`setup -> receive -> transfer -> availability -> ledger`

### Proven root cause

The raw-material path was inconsistent with warehouse identity:

1. `raw_material_inventory` represented only a branch aggregate.
2. Raw FIFO batches did not carry an operational `warehouse_id` contract.
3. Purchase/receipt records knew the warehouse, but raw `_raw_add` calls could discard it.
4. `check_product_availability` read branch-wide raw stock, allowing one warehouse to satisfy another warehouse's availability.
5. Same-branch raw-material warehouse transfers were explicitly rejected with `RAW_MATERIAL_SAME_BRANCH_WAREHOUSE_TRANSFER_UNSUPPORTED`.
6. Legacy raw helper signatures could consume/add branch-wide stock without an explicit warehouse.
7. Several old integration fixtures created opening raw stock without a warehouse, masking the branch-pooled behavior.

### Fix implemented

- Added warehouse identity to `raw_material_batches` and a warehouse-level raw stock projection.
- Kept `raw_material_inventory` only as the branch aggregate compatibility summary; it is no longer the operational warehouse truth for availability/FIFO movement.
- Added warehouse-aware `_raw_add` and `_raw_remove_fifo` contracts.
- Purchase receipt raw posting now uses the purchase/receipt warehouse explicitly.
- Direct `process_purchase` compatibility resolves the purchase warehouse and preserves raw UOM normalization before delegating to the warehouse-aware helper.
- Product availability reads raw capacity from the requested warehouse only.
- Same-branch raw transfers now debit the source warehouse and credit the destination warehouse exactly once.
- Cross-branch transfer compatibility resolves explicit source/destination warehouses; no same-name or branch-wide stock fallback was introduced.
- Legacy raw helper signatures now resolve a warehouse only from their authoritative business document (purchase, receipt, sale, transfer). If no warehouse can be resolved, they fail with `WAREHOUSE_REQUIRED` instead of falling back to branch stock.
- Production raw consumption now passes `p_warehouse_id` directly into the warehouse-aware FIFO path.
- Existing opening-stock/manufacturing fixtures were updated to identify their warehouse explicitly rather than relying on implicit branch stock.
- Operational product composition remains based on `product_unit_links`; no live `product_components` fallback was introduced.

### Files / migrations

- `supabase/migrations/20260911150000_raw_material_warehouse_stage_b.sql`
- `supabase/migrations/20260911151500_raw_material_warehouse_legacy_bridge.sql`
- `tests/integration/raw_material_warehouse_cycle.test.ts`
- `tests/integration/cross_branch_inventory_transfer.test.ts`
- `tests/integration/auto_production_sale_availability.test.ts`
- `tests/integration/phase2_production_variance.test.ts`
- `tests/integration/nested_manufactured_units.test.ts`
- `tests/integration/unit_inventory_hierarchy.test.ts`
- `tests/integration/unit_production_sale_flow.test.ts`

### Focused Stage B proof

`raw_material_warehouse_cycle.test.ts` proves:

- receive posts raw stock only to the selected warehouse;
- another warehouse remains unchanged;
- inventory ledger receipt row contains the receiving `warehouse_id`;
- availability succeeds in the stocked warehouse and fails in the unstocked warehouse;
- availability definition retains `product_unit_links` and a warehouse-filtered raw source;
- same-branch raw transfer decreases source once and increases destination once;
- transfer produces exactly one negative and one positive warehouse ledger movement;
- re-approval is rejected and cannot duplicate stock/ledger;
- forged cross-branch access is denied.

Existing cross-branch, production, sale, UOM, RLS and inventory suites were also kept green after the warehouse contract was enforced.

### CI investigation history

- Verify #1081: application checks green; Fresh DB failed because the first migration used a brittle textual marker while patching `check_product_availability`.
- Commit `dcd637b1e4397537db8fe4bb9cc9d9dbb57d1d80` replaced that brittle match with a normalized/regex-safe patch.
- Verify #1082: Fresh DB + Schema green; three integration regressions exposed branch-pooled fixtures / direct purchase compatibility.
- Added the legacy bridge migration and updated only fixtures that represented opening stock without warehouse identity.
- Verify #1086: Fresh DB + Schema green; four production fixtures still seeded raw stock without a warehouse and were corrected to use their declared production warehouse.
- Final code/test head `4744e217c2e4b19a1ea5f75b1da3dd9cc90e2326` passed Verify main #1090 Full Green.

### Verification/tests — final Stage B evidence

- Locked Supabase project identity: ✅
- Frontend API contract: ✅
- Lint: ✅
- Application typecheck: ✅
- Application/test-suite typecheck: ✅
- Unit tests: ✅
- Build: ✅
- Fresh DB / canonical migrations: ✅
- Schema verification: ✅
- DB identity: ✅
- Explicit Permission-First CI role capabilities: ✅
- Integration + Security/RLS regression suite: ✅
- Focused raw receive/warehouse/availability/transfer/ledger/idempotency coverage: ✅
- Cross-branch transfer coverage: ✅
- Production / nested manufacturing / purchase UOM regression coverage: ✅
- Browser Smoke / Playwright: ✅
- Verify main #1090: **FULL GREEN**

### Stage B closure

- Root Stage B is **VERIFIED / CLOSED**.
- No Production migration was applied.
- Production Supabase `azzdesuowpdcoflmyezn` was not modified.
- `main` was not directly modified.
- Do not start Root Stage C until the user writes a **new** `تم` after this closure report.

## New-chat handoff checkpoint

- Repository: `Premieros/johna-s`
- Production Supabase ONLY: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Working branch: `development/stabilization-phase-2`
- Source of Truth: `docs/CURRENT_WORK_PLAN.md`
- Live log: `docs/STABILIZATION_WORK_LOG.md`
- Stage 1: **VERIFIED / CLOSED**.
- Root Stage B: **VERIFIED / CLOSED** at code/test head `4744e217c2e4b19a1ea5f75b1da3dd9cc90e2326`, Verify #1090 Full Green.
- Production writes during Stage B: **NONE**.
- PR #68 remains unmerged pending explicit merge action.
- Do not start Root Stage C until the user writes a new `تم`.

## Deferred branch audit note

- `Premieros-patch-1`: **Superseded / Dangerous — DO NOT MERGE**. It contains changes that can weaken the Supabase identity lock / reintroduce environment ambiguity. No deletion is performed until the later branch-audit stage.

## Negative Raw-Material Inventory — sell-through allowance

Status: **IN PROGRESS (frontend + verification complete; Full Verify + Production decision pending)**
Working branch: `development/stabilization-phase-2`
New migration: `supabase/migrations/20260911160000_negative_raw_material_inventory.sql`

### Goal

Allow raw-material inventory to go negative on a sale so manufacturing/sales are not blocked by a few units of shortage. The shortage is recorded as an accounting debt (negative raw-material batch) that purchases later offset arithmetically via `SUM` netting — no clamping, no hidden zeroing.

### Design decisions

- Shortage is written as a **negative raw-material batch** (`quantity = -shortage`, `source_type = 'sale_oversold'`, warehouse = the sale warehouse). Branch/warehouse net raw stock = `SUM(quantity)`; a later purchase with the same raw material offsets the debt naturally.
- **Strict scope**: manufactured units / ready products / transfers keep `allow_negative` **OFF** by default. Only the sale-deduction core opts in.
- The availability RPC returns a new `raw_shortage_only` signal for non-manufactured products whose raw stock is negative but >= the recipe need, so POS can sell them while still labeling them as unavailable.
- Stage B regression was fixed inside this migration: sale deduction passes the explicit warehouse into the canonical `_raw_remove_fifo(..., true)`, and void restore passes `v_event.warehouse_id` into canonical `_raw_add`.

### Files

- `supabase/migrations/20260911160000_negative_raw_material_inventory.sql`
- `tests/unit/negative_raw_material_inventory_contract.test.ts` (8 contracts on the migration text)
- `tests/integration/negative_raw_material_inventory.test.ts` (12 cases; skipped locally without `SUPABASE_DB_URL`)
- Frontend: `PosWorkspacePage.tsx` (`rawShortageMap`), `ProductBrowser.tsx` (`rawShortageOnly` prop + sellable raw-shortage cards), `usePosOrderBase.ts` / `usePosOrder.ts` (hook-level stock guards exempt raw-shortage products)

### Verification status

- `npm run typecheck` (app): ✅
- `npm run lint` on all touched files: 0 errors; the single `kitchenSendsForActive` warning is pre-existing baseline.
- Contract tests reading the touched files (`posAvailabilityDisplayContract`, `posAvailabilityGateContract`, `branchPrintContract`, `posProductImagesRedesignContract`, `productScanContract`, `recentUiWiringContract`, `posOperatorDisplayContract`, negative contract): ✅
- `posSharedShiftWorkspaceContract` failure is the pre-existing environmental CRLF failure (unchanged).
- Full official suite (`npm run lint` + `npm run typecheck:all` + `npm run test:unit` + `npm run build`): ✅ — lint 0 errors/3 pre-existing warnings; unit 479 passed / 3 pre-existing CRLF failures; typecheck + build clean.

### Next

1. Run the full official check suite once more.
2. No Production migration until an explicit decision and Full Verify Green.

## 2026-09-12 — Branch cleanup checkpoint on main

### Canonical identities

- Repository: `Premieros/johna-s`
- Production branch: `main`
- Production Supabase ONLY: `azzdesuowpdcoflmyezn`
- Source of Truth: `docs/CURRENT_WORK_PLAN.md`
- Live log: `docs/STABILIZATION_WORK_LOG.md`

### Recent merged fixes

- PR #80 — POS raw-shortage availability/cart sell-through stabilization — merged and verified.
- PR #81 — POS raw-shortage cart guard follow-up — merged.
- PR #82 — purchase invoice warehouse identity repair — merged to `main` at `e0c9f35682ca2725cb244285eae6326d9e320e3a`.
- PR #83 — remove ambiguous `_raw_remove_fifo` warehouse-aware overload — merged to `main` at `6f38d1a04e87290be7553d8d1ec593dee564ed15` after Verify #1187 Full Green.
- Post-merge Verify #1189 and Deploy #610 were started automatically after PR #83 merge; confirm final status before any new Production migration/action.

### Persistent development branch policy

- **KEEP:** `development/cloud-print-agent`
- This is the only persistent `development/*` branch to preserve.
- It contains the unfinished Premier Print Agent work tracked by Draft PR #78.
- Draft PR #78 is not approved for Production yet; its migration must not be applied to Production until its own verification is complete.
- `development/windows-thermal-print-v2` / Draft PR #76 is superseded by the cloud print agent line.
- All other historical `development/*` branches may be deleted during cleanup.

### Temporary fix branches

- The former `fix/raw-remove-fifo-overload-ambiguity` branch belonged to merged PR #83 and no longer needs to be preserved after cleanup.
- Going forward, `fix/*` branches are temporary only while a focused PR is active and may be deleted after merge/closure plus post-merge verification.

### Intended branch layout after cleanup

1. `main` — Production only.
2. `development/cloud-print-agent` — single persistent development branch.
3. Temporary `fix/*` only while an active focused PR exists.

### Safety rules preserved

- No force push.
- No direct feature development on `main`.
- Permission-First authorization remains mandatory; role names are labels only, Super Admin is the only implicit bypass.
- Do not weaken RLS or tests.
- Never use another Supabase project; Production identity remains `azzdesuowpdcoflmyezn` only.
- Do not reintroduce cross-branch or cross-warehouse fallback.

## 2026-09-12 — Backend Simplification Program: PR 1 (merged) and PR 2 (in flight)

### Canonical identities (unchanged)

- Repository: `Premieros/johna-s`
- Production branch: `main` (merged PRs #80–#84; after PR #84 merge `3fe6d3c`; parallel fix `44cc490` present)
- Production Supabase ONLY: `azzdesuowpdcoflmyezn`
- Working branch: `development/inventory-contracts` (rebased onto the updated `main` for PR 2)

### Decision (user redirection)

Stop the wide multi-layered architecture effort. Keep exactly the user-facing capabilities; simplify the backend only (remove internal duplication, dead paths proven unused, duplicate business rules). No feature removal without proof + full replacement; no production data changes; no `branch_id`/`warehouse_id` rewrites without a proven defect + explicit mapping.

### Baseline on the new branch (green)

- `npm run lint` — 0 errors / 3 pre-existing warnings.
- `npm run typecheck:all` — ✅.
- `npm run test:unit` — 498 passed / 3 environmental CRLF text-contract failures (pre-existing, no source change).
- `npm run build` — ✅.
- Fresh DB / integration / browser smoke: CI-only (no local `SUPABASE_DB_URL`).

### Dependency audit (evidence)

- Frontend: 15 feature modules, 62 pages, 43 components; `supabase.from()` direct = 258, RPC via `api.<domain>` = 113, direct RPC in pages = 34; `src/api` = 128 unique RPCs / 14 domains.
- Permissions: single RBAC source (`lib/permissionDefs.ts` — 110 permissions / 20 groups); no parallel RBAC. `useV2Can` only delegates to `useCan`.
- Backend: 295 migrations; 572 `CREATE FUNCTION` → 282 unique names; **134 redefined** (~48%). RLS: 107 ENABLE / 684 CREATE policies / 702 DROP across 77 files. DB-defined RPCs not called by `src`: 161 (mostly intentional internal helpers `_*`/`private`). `src` calls missing from migrations: 0.
- Dead code proven (REMOVE-LATER, deletion only in a dedicated PR): `src/services/subscription/subscriptionService.ts` (dead object; only re-exported via barrel), `src/features/admin/pages/SubscriptionsAdminPage.tsx`, `src/features/reporting/pages/ReportDeepLinkPage.tsx`, `src/components/subscription/SubscriptionBanner.tsx` (+ dormant `useSubscription` chain).
- HIDE/LEGACY: `src/v2/**` gateway reachable only by direct URL (not in menu); `DashboardExecutiveInsightsV2` is live (name only).

### PR 1 (Simplification Map + Dependency Audit) — MERGED

- Branch: `development/architecture-baseline` (from `main` 952b315).
- Commit merged: `b5331078b0d7ea559930f95aa7e051d3eb719f7e` — files: `docs/SIMPLIFICATION_MAP.md` (new), `docs/CURRENT_WORK_PLAN.md`, `docs/STABILIZATION_WORK_LOG.md`, `scripts/db/pos_availability_diagnosis.sql` (new, read-only).
- PR: **#84 — MERGED as `3fe6d3c`** after re-running the failed `db` job. The initial failure was the transient `deadlock detected (40P01)` flake in `tests/integration/user_management_permission_first.test.ts`; the rerun was fully green (verify ✅, db ✅ 1m9s, browser-smoke ✅ 3m47s; Supabase Preview skipped).

### PR 2 — evidence audit results (docs, Full Verify pending)

Independent branch `development/inventory-contracts` (from `main`, rebased on the updated `main`; preserves all PR 1 + PR 2 documentation). Dual audit (backend + frontend) produced `docs/INVENTORY_CONTRACTS.md`. Headline facts:

- Availability canonical family: `check_product_availability` (`20260912075859:127`) is the single authoritative evaluator; `get_pos_product_availability` (`20260912075859:432`) and `get_pos_cart_product_availability` (`20260911173000:259`) are POS snapshots derived from it; `check_pos_cart_availability` strict/lax wrapper (`20260912113000:13-21`).
- Source of Truth per layer: ready goods = `inventory` + `inventory_batches`; raw = `raw_material_batches` (warehouse FIFO, operational) with `raw_material_inventory` as branch summary only; units = `inventory_unit_batches`; ledger = `inventory_ledger` (+`stock_transactions`, +history views).
- **No `AFTER` triggers maintain balances** — all stock mutation happens inside SECURITY DEFINER RPCs (confirmed across all 295 migrations).
- Highest-risk client write bypass: `src/api/domains/manufacturing.ts:156-241` (`completeOrder` fallback mutates `raw_material_inventory`, `inventory`, `raw_material_movements`, `production_waste` directly) — documented, fix deferred to a future RPC-strengthening PR.
- Dead file confirmed: `src/lib/sales-deduction.ts` (0 imports) → REMOVE-LATER (PR 7 scope).
- Legacy layers documented (kept): `consume_order_kitchen_inventory` vs `send_to_kitchen`; `_raw_remove_fifo`/`_raw_add` legacy bridges.
- Map of direct `from()` reads on balances to reroute through `src/api/inventory` in future PRs (with Regression requirement).

### Status

- PR 1: **#84 MERGED**. PR 2: **#86** submitted; Full Verify running after rebase onto the updated `main` (sequence: merge PR 1 → rebase PR 2 → Full Verify on #86 → merge #86 → then PR 3 Catalog).
- No Production migration applied; Production Supabase `azzdesuowpdcoflmyezn` untouched.
