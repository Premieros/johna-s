# ERP-05 WASTE CENTER — ACTIVE WORK LOG

Repository: `Premieros/johna-s`  
Production Supabase: `azzdesuowpdcoflmyezn` (`john's`)  
Branch: `development/erp05-waste-center-20261003`  
Baseline: `main@9f542a52fd853e34ad429195903f25c8c9d6da43`  
Last updated: 2026-10-03

## Work status
State: **ACTIVE — AUDIT COMPLETE / IMPLEMENTATION STARTED**

## Guardrails
- No direct write to `main`; no force push.
- Unexpected branch/main movement => **STOP_AND_RECONCILE**.
- No Production schema/data/history mutation in this branch.
- No Production migration before exact-head Full Verify Green + explicit user approval.
- Preserve Permission-First, branch isolation, warehouse isolation, FIFO truth and audit history.
- Printing, Print Agent, KDS routing, POS sale deduction and `send_to_kitchen` remain frozen.
- Do not revive the cancelled management/dashboard/reports/treasury restructuring scope.

## Existing implementation verified
ERP-05 is not a greenfield feature. Current `main` already contains:
- `waste_categories` and `waste_entries`;
- permissions `waste.view/create/approve/report`;
- `create_waste_entry`, `approve_waste`, `get_waste_report`;
- approval queue integration;
- `WasteCenterPage` + feature service boundary;
- product/inventory-unit target selection with exact branch/warehouse checks;
- stock deduction only at approval time;
- approved waste reporting and dashboard visibility;
- integration coverage for create/approve/report.

## Production read-only audit — 2026-10-03
Project `azzdesuowpdcoflmyezn` was inspected with SELECT-only SQL.

Results:
- product `inventory` vs `inventory_batches` quantity mismatches: **0**;
- positive product inventory rows without FIFO batches: **0**;
- maximum product inventory/batch gap: **0**;
- current `waste_entries`: **0 approved / 0 pending / 0 total**.

No Production write was executed.

## Proven gaps
1. **Approved waste cost is not FIFO-authoritative**
   - `create_waste_entry` accepts `p_unit_cost` from the client.
   - `approve_waste` deducts FIFO batches but records `waste_entries.unit_cost` and ledger cost from the stored client value.
   - The batch `unit_cost` values actually consumed are not accumulated into waste cost.
   - Result: Waste analytics / Food Cost impact can diverge from inventory FIFO truth.

2. **Product FIFO deduction does not fail closed on a missing batch layer**
   - Product aggregate `inventory.quantity` is checked first.
   - The batch loop does not currently verify `v_remaining = 0` after deduction.
   - Production is currently clean (0 mismatches), so a forward fail-closed guard is safe and prevents future divergence.

3. **Legacy production waste is still creatable in the UI**
   - Current model-alignment docs state legacy `production` waste must remain visible historically but not be offered as a new operational waste type.
   - `WasteCenterPage` currently includes `production` in the create form.
   - The page already hides it from the filter, which does the opposite of the desired behavior: legacy rows should remain filterable/visible while new creation should exclude them.

4. **Employee attribution is structurally present but unused**
   - `waste_entries.employee_id` and `create_waste_entry(... p_employee_id)` already exist.
   - Current frontend passes no employee ID.
   - Minimal completion can default employee attribution to the authenticated actor without introducing user-directory permission coupling.

5. **Kitchen waste needs an explicit operational classification path**
   - Existing seeded categories cover raw/product/production/expired/damaged.
   - There is no dedicated kitchen-waste category.
   - The safest backward-compatible model is a category (source/reason context), while inventory target/type remains product or inventory unit. No new retired-manufacturing workflow is required.

## Implementation slices
### Slice A — UI compatibility guard
- Keep legacy `production` rows visible/filterable.
- Remove `production` from new-waste creation choices.
- Add a regression contract for this behavior.

### Slice B — database costing/integrity contract
Planned forward-only migration:
- derive approved product/inventory-unit waste cost from FIFO batches actually consumed;
- update approved waste `unit_cost` from actual consumed FIFO value;
- write ledger/entry cost from the same authoritative value;
- fail closed if product aggregate stock cannot be fully matched by FIFO batches;
- default `employee_id` to `auth.uid()` when omitted;
- seed an idempotent kitchen-waste category;
- preserve existing RPC signatures and grants.

Migration generation note:
- Supabase CLI is unavailable in the current execution environment.
- Per the Supabase workflow, a new migration file must be created via `supabase migration new`; therefore the migration file is intentionally not invented manually in this environment.
- Production remains untouched.

### Slice C — verification
- Unit contract for UI legacy-production behavior.
- DB integration tests for mixed-cost FIFO waste, exact ledger cost, rollback on inconsistency, employee attribution, permissions and branch/warehouse scope.
- Full exact-head CI before any merge decision.

## Next action
Implement and verify Slice A now. Keep Slice B blocked only on sanctioned migration-file generation; do not alter historical migrations and do not apply SQL to Production.
