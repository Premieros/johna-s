# Stock Count Excel — 2026-09-30

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/stock-count-excel-20260930`
Current PR: `#423`
Last updated: 2026-09-30 20:34 Africa/Cairo
State: **BLOCKED**

## Work status
- User requested a complete month-opening raw-material count workflow for Smouha and Cleopatra before 2026-10-01 operations.
- Existing canonical stock-count lifecycle already exists: Draft -> Submit -> Approve -> Apply.
- Excel export/import implementation is on PR #423 and intentionally adds no Production migration.
- First Verify run #3560 failed only at the mandatory active-work-log gate because this track had not yet been declared active.
- Workbook hardening, draft guards, and end-to-end DB lifecycle coverage are now added on the active branch.
- No Production inventory data has been changed by this feature.

## Guardrails
- No direct write to `main`; no force push.
- No Production migration is required for this feature.
- No direct client update of `raw_material_inventory`, `raw_material_batches`, inventory ledger, or FIFO layers.
- Stock writes remain behind the existing stock-count RPC workflow.
- Branch + warehouse isolation must remain authoritative.
- Permission split remains `inventory.count.create`, `inventory.count.approve`, `inventory.count.reject`, and `inventory.count.apply`.
- Printing, Print Agent, KDS, POS, payments, shifts, and kitchen deduction are frozen.
- No Production stock rewrite/reset/reseed for testing.

## Baseline
- Main baseline at branch creation: `b9e2238cdafcd5b79d6cea73ce80fe6a6ed680fa`.
- Production already contains canonical functions `create_stock_count`, `submit_stock_count`, `approve_stock_count`, `reject_stock_count`, and `apply_stock_count`.
- Production has an applied historical Smouha opening document `OPENING-SMOUHA-2026-09-01`; the new October workflow must be a physical count/variance adjustment, not a second opening-balance injection.
- Raw warehouse operational quantity comes from warehouse-aware raw-material batches / `raw_material_warehouse_inventory`.

## Root-cause ledger
1. StockCountsPage already supports raw-material counts but requires manual line entry.
2. There was no Excel export from Stock Counts, so a full first-of-month physical count was operationally cumbersome.
3. Generic Excel export can create a Summary sheet when title/subtitle are used; generic import reads the first sheet, so stock-count workbooks must remain a single data sheet.
4. Counted quantities must never be applied during upload; upload must only prepare the draft.
5. The apply RPC recalculates current warehouse quantity at application time, so long delays between physical count and Apply can create an invalid variance if stock movements continue.
6. Matching by code/name could allow a changed workbook row to target the wrong material; exact material identity is therefore mandatory.
7. Duplicate rows must not silently overwrite one another.
8. Changing the selected warehouse after importing a workbook could otherwise leave counts from the previous warehouse in memory.
9. Switching a partially populated draft to Full could otherwise allow a logically incomplete month-opening count.

## Change ledger
- Added in-page Excel export after selecting branch + warehouse.
- Workbook columns: raw-material ID, code, name, system quantity reference, counted quantity, variance reason, branch ID, warehouse ID.
- Export system quantity is read from `raw_material_batches` for the selected branch + warehouse.
- Workbook is intentionally single-sheet so the same file can be re-imported safely.
- Import validates exact branch ID, warehouse ID, and raw-material ID; no code/name fallback can redirect a row.
- Duplicate raw-material rows are rejected explicitly instead of silently overwriting quantities.
- Zero is accepted; negative and non-numeric counts are rejected.
- Full counts require a counted quantity for every active raw material; partial/cycle counts may leave rows blank.
- Draft creation re-validates duplicate, missing, blank, non-numeric, and negative quantities even if data was entered manually.
- Changing warehouse clears loaded draft lines to prevent cross-warehouse reuse.
- New stock counts now default to `full` for the month-opening workflow, while partial/cycle remain selectable.
- The primary action is labeled `Save Draft / حفظ المسودة` to make clear that no stock is applied at that step.
- Upload only populates the draft form and performs no stock write.
- Existing `create_stock_count` RPC persists the draft; existing submit/approve/reject/apply functions remain unchanged.
- Added focused contract and validation coverage in `tests/unit/stockCountExcelWorkflow.test.ts` and `tests/unit/stockCountExcelValidation.test.ts`.
- Added DB integration coverage in `tests/integration/stock_count_excel_lifecycle.test.ts` proving Create/Submit/Approve do not change stock and Apply alone posts the FIFO-backed variance.
- No database migration, print, KDS, POS, payment, or shift code touched.

## Verification ledger
- Production RPC signatures inspected read-only: ✅
- Production `create_stock_count` and `apply_stock_count` definitions inspected read-only: ✅
- Production historical opening-count state inspected read-only: ✅
- First Verify #3560: ❌ mandatory worklog gate only; code checks were skipped.
- Mandatory worklog/current-plan activation: ✅
- Intermediate Verify reached mandatory log, API contract, lint, app typecheck, and test-suite typecheck successfully before cancellation by a newer commit: ✅ through typecheck.
- Workbook edge-case coverage added for zero / negative / non-numeric / duplicate / foreign branch / foreign warehouse / incomplete full count: pending final CI execution.
- Full RPC lifecycle integration test added: pending final CI execution.
- Final focused unit/build verification on exact head: pending.
- DB integration/security: pending.
- Browser Smoke: pending.
- Full Verify exact head: pending.

## Production gate
Merge/deploy is blocked until:
- malformed/duplicate/foreign workbook rows have deterministic validation;
- focused stock-count Excel regression is Green;
- exact-head Full Verify is Green;
- DB integration/security is Green;
- Browser Smoke is Green;
- branch is reconciled with latest `main`;
- user gives explicit merge approval.
No Production migration is expected.

## Next action
Run exact-head Full Verify on the documentation-complete head. Fix any unit/type/integration/browser failure before merge. If Green, reconcile latest main once more and present the PR for explicit merge approval.

## Mandatory update protocol
Verify branch/main relationship before every repository write. Update this log after every material code/test/CI/merge change. Keep `State: **BLOCKED**` until all merge gates are satisfied.
