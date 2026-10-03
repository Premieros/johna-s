# ERP-05 Waste Center — FIFO Approval Design

Date: 2026-10-03  
Repository: `Premieros/johna-s`  
Production Supabase: `azzdesuowpdcoflmyezn` (`john's`)  
Status: **DESIGN LOCKED — MIGRATION FILE NOT YET GENERATED**

## Scope
This document locks the backend contract for ERP-05 without applying any SQL to Production.

The executable forward-only migration must be generated with the sanctioned Supabase migration workflow when the CLI is available. Do not rewrite `089_waste_center.sql` or any later historical migration.

## Verified Production facts
Read-only inspection confirmed:
- `waste_entries`: 0 rows.
- `waste_categories`: 0 rows.
- product aggregate inventory vs product FIFO-batch quantity mismatches: 0.
- positive product inventory rows without FIFO batches: 0.
- `create_waste_entry` and `approve_waste` are `SECURITY DEFINER`, owned by `postgres`, with EXECUTE only for `postgres`, `authenticated`, and `service_role`.
- `approve_waste` currently deducts FIFO quantities but does not read FIFO-layer `unit_cost`; it records the pending entry's client-supplied `unit_cost`.
- product approval currently has no post-loop `v_remaining = 0` assertion.
- `waste_entries.total_cost` is generated as `quantity * unit_cost`.
- batch costs are `numeric(12,2)`; product ledger `unit_cost` supports `numeric(18,6)`; inventory-unit entry cost is `numeric(12,2)`.

## Locked backend contract

### 1. New operational production-waste creation is forbidden
Keep the table check value `production` for historical rows, but reject it in `create_waste_entry`.

Required error:
`LEGACY_PRODUCTION_WASTE_READ_ONLY`

Allowed new operational values remain:
- `raw_material`
- `finished_good`
- `expired`
- `damaged`

The frontend and feature-service already enforce the same rule on PR #437.

### 2. Employee attribution defaults to the authenticated actor
When `p_employee_id` is NULL, persist:
`employee_id = auth.uid()`

Do not weaken the existing `waste.create`, branch-access, warehouse-branch, target-branch, or category guards.

### 3. Product waste approval uses consumed FIFO-layer cost
For a product target:
1. Lock the aggregate `inventory` row.
2. Reject insufficient aggregate stock exactly as today.
3. Lock positive `inventory_batches` for the same product, branch, and warehouse in the existing FIFO order.
4. For each layer:
   - `v_take = least(v_remaining, batch.quantity)`
   - decrement that batch;
   - accumulate `v_actual_cost += v_take * batch.unit_cost`.
5. After the loop, require `v_remaining = 0`.
6. If not zero, raise a deterministic integrity error before commit. The transaction must roll back the aggregate inventory decrement and all partial layer changes.
7. Write one `inventory_ledger` waste row:
   - quantity = negative approved quantity;
   - total_cost = negative rounded actual FIFO cost;
   - unit_cost = actual FIFO weighted-average cost (ledger supports 6 decimal places);
   - existing before/after quantities and reference metadata preserved.
8. Set `waste_entries.unit_cost` to the rounded display weighted average. `total_cost` remains generated.

Required integrity error family:
`FIFO_BATCH_COVERAGE_MISMATCH:product`

### 4. Inventory-unit waste approval preserves exact layer cost
For an inventory-unit target:
1. Lock positive `inventory_unit_batches` for the same unit, branch, and warehouse in the existing FIFO order.
2. Sum available quantity and reject insufficient stock exactly as today.
3. For each consumed layer:
   - decrement the batch;
   - accumulate actual cost;
   - insert one negative `inventory_unit_entries` row for that consumed layer using the batch's own two-decimal `unit_cost`.
4. Require `v_remaining = 0`; otherwise roll back atomically.
5. Set `waste_entries.unit_cost` to the rounded display weighted average.

Layer-level inventory-unit entries avoid losing cents when mixed FIFO layers have different prices.

Required integrity error family:
`FIFO_BATCH_COVERAGE_MISMATCH:inventory_unit`

### 5. Waste reporting uses authoritative movement cost
`get_waste_report` must continue to:
- require `waste.report`;
- enforce branch access;
- report approved waste only;
- preserve the existing date/history guard behavior.

Cost source per approved waste row:
- product target: actual `inventory_ledger.total_cost` rows with `entry_type='waste'`, `reference_type='waste'`, `reference_id=waste_entries.id`;
- inventory-unit target: sum of `abs(quantity) * unit_cost` from `inventory_unit_entries` with the same waste reference;
- fallback to `waste_entries.total_cost` only when no authoritative movement rows exist, preserving historical compatibility.

Do not use the pending/client estimate as the authoritative report cost.

### 6. Category repair is idempotent
Production currently has zero category rows, so the Waste Center cannot create an entry because category selection is required.

The migration must idempotently ensure active categories for:
- `هالك خامات` / `Raw Material Waste`
- `هالك منتج` / `Finished Goods Waste`
- `هالك مطبخ` / `Kitchen Waste`
- `منتهي الصلاحية` / `Expired`
- `تالف` / `Damaged`

Compatibility:
- if the historical typo `هالك مraw` exists and `هالك خامات` does not, rename the exact seed row rather than creating a duplicate;
- keep historical `هالك إنتاج` rows readable;
- mark the exact legacy seed category `هالك إنتاج` / `Production Waste` inactive so it is not offered for new creation.

Do not delete category history.

## Security invariants
The replacement RPCs must preserve:
- `SECURITY DEFINER`;
- `SET search_path = public, pg_temp`;
- explicit `auth.uid()` requirement;
- current permission checks;
- current branch and warehouse validation;
- EXECUTE ACL: `authenticated`, `service_role`, owner only; no `PUBLIC` or `anon` EXECUTE.

After the migration exists, run Supabase security/performance advisors and the existing RLS/integration suite.

## Required regression coverage
The executable migration must not be merged until tests prove:
1. mixed-cost product FIFO layers produce exact authoritative ledger total;
2. product aggregate/batch mismatch fails and rolls back every quantity change;
3. mixed-cost inventory-unit FIFO creates layer-priced movement rows and exact report total;
4. insufficient stock leaves all rows unchanged;
5. omitted employee ID resolves to the authenticated actor;
6. `production` creation is rejected while historical production rows remain readable/filterable;
7. category seed is idempotent and Kitchen Waste is available;
8. branch, warehouse, permission, and history guards remain unchanged;
9. `get_waste_report` uses movement cost, not the client estimate.

## Production gate
No SQL in this design has been executed on Production.

Production apply remains blocked until:
- a sanctioned forward-only migration file exists;
- exact-head Verify/DB/Security/RLS/Browser Smoke are Green;
- a final Production read-only reconciliation is clean;
- the user gives separate explicit approval for Production application.
