# ERP-05 WASTE CENTER — ACTIVE WORK LOG

Repository: `Premieros/johna-s`  
Production Supabase: `azzdesuowpdcoflmyezn` (`john's`)  
Branch: `development/erp05-waste-center-20261003`  
Current PR: `#437`  
Last updated: 2026-10-03

## Work status
State: **BLOCKED**

Blocked only on exact-head CI and the sanctioned database-migration generation path. No Production write is authorized.

## Guardrails
- No direct write to `main`; no force push.
- Unexpected branch/main movement => **STOP_AND_RECONCILE**.
- No Production schema/data/history mutation in this branch.
- No Production migration before exact-head Full Verify Green + explicit user approval.
- Preserve Permission-First, branch isolation, warehouse isolation, FIFO truth and audit history.
- Printing, Print Agent, KDS routing, POS sale deduction and `send_to_kitchen` remain frozen.
- Do not revive the cancelled management/dashboard/reports/treasury restructuring scope.

## Baseline
- Main baseline: `9f542a52fd853e34ad429195903f25c8c9d6da43`.
- ERP-05 is not greenfield: Waste Center UI, permissions, tables and RPC workflow already exist.
- Canonical flow: `create_waste_entry` -> pending -> `approve_waste`.
- Product/inventory-unit targets are branch/warehouse scoped.
- Stock deduction happens only on approval.
- Production read-only audit on 2026-10-03 found:
  - product `inventory` vs `inventory_batches` mismatches: **0**;
  - positive product inventory rows without FIFO batches: **0**;
  - maximum aggregate-vs-batch gap: **0**;
  - `waste_entries`: **0 approved / 0 pending / 0 total**.
- No Production write was executed.

## Root-cause ledger
1. Approved waste cost is not FIFO-authoritative:
   - `create_waste_entry` accepts `p_unit_cost` from the client.
   - `approve_waste` deducts FIFO batches but records cost from `v_entry.unit_cost`.
   - Production function inspection confirms `approve_waste` does not use `v_batch.unit_cost`.

2. Product FIFO deduction does not fail closed on missing batch coverage:
   - aggregate inventory is checked first;
   - batch deduction loop does not verify all requested quantity was consumed from FIFO layers;
   - Production currently has 0 mismatches, so a forward guard is safe.

3. Legacy production waste is incorrectly offered for new operational creation:
   - current model-alignment docs keep legacy `production` rows for historical visibility only;
   - previous UI excluded `production` from the filter but still allowed it in the create form.

4. Employee attribution exists structurally but is unused:
   - `waste_entries.employee_id` and `p_employee_id` already exist;
   - current frontend passes no employee ID.

5. Kitchen waste has no explicit operational category:
   - safest compatibility path is a category, not a revived manufacturing workflow.

## Change ledger
Implemented on PR #437:
- activated ERP-05 as the sole current work track;
- added this ERP-05 gap-audit log;
- changed `WasteCenterPage` so legacy `production` remains visible/filterable historically;
- new operational creation now uses `CREATABLE_WASTE_TYPES` and excludes `production`;
- added `tests/unit/wasteCenterLegacyProductionContract.test.ts`.

No database migration has been created or applied in this branch head.
No Production schema/data/history write has occurred.

## Verification ledger
- Branch created from `main@9f542a52fd853e34ad429195903f25c8c9d6da43`.
- Pre-PR reconcile: branch ahead, behind 0.
- Draft PR #437 created.
- Verify run #3644 / workflow run `37121766316` failed only because this mandatory log lacked required structural headings and `State: **BLOCKED**`.
- No runtime/unit assertion failure was identified before that gate stopped the pipeline.
- Documentation is now being corrected to satisfy the mandatory worklog contract.
- DB and browser jobs were skipped because the verify job failed at the worklog gate.

## Production gate
State: **BLOCKED**
- No Production migration is authorized.
- No Production schema/data/history write is authorized.
- Any future ERP-05 database migration must be forward-only, generated through the sanctioned migration workflow, pass exact-head Verify/DB/Security/RLS/Browser Smoke, and receive separate explicit approval before Production application.

## Next action
Run exact-head CI again after this worklog-only correction. If Green, continue only with the sanctioned forward-only migration path for FIFO-authoritative waste costing and integrity guards.

## Mandatory update protocol
- Re-read latest `main` and branch HEAD before every repository write.
- Unexpected divergence => **STOP_AND_RECONCILE**.
- Keep this log synchronized after every material audit, implementation or verification checkpoint.
- Keep State **BLOCKED** until exact-head CI is Green and merge/Production gates are explicitly approved.


## ERP-05 FIFO/category checkpoint
- Production read-only inspection confirms `waste_categories` currently has **0 rows**; operational waste creation therefore has no selectable category.
- Original seed in migration 089 contains the typo `هالك مraw`.
- Production `approve_waste` deducts FIFO quantities but does not read batch `unit_cost`; it persists the pending/client estimate.
- Product approval still lacks a post-loop `v_remaining = 0` integrity assertion.
- `waste_entries.total_cost` is generated from `quantity * unit_cost`; authoritative report cost must come from actual movement rows for mixed-cost FIFO.
- Current RPC ACLs are owner + `authenticated` + `service_role`; no `PUBLIC` or `anon` EXECUTE.
- UI unit cost is now display-only and labelled as an estimate until approval-time FIFO costing is authoritative.
- Feature service now rejects legacy `production` creation with `LEGACY_PRODUCTION_WASTE_READ_ONLY`.
- Backend design is locked in `docs/ERP05_WASTE_FIFO_APPROVAL_DESIGN_2026-10-03.md`.
- No Production write or migration was executed.
