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
