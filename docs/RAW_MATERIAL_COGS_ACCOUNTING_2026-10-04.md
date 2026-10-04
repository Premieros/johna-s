# RAW MATERIAL COGS ACCOUNTING — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/raw-material-cogs-accounting`
Current PR: `#445`
Last updated: 2026-10-04

## Work status
State: **BLOCKED**

Implementation is on a Draft PR and is not applied to Production. Exact-head Full Verify must be Green and Production requires separate explicit approval.

## Guardrails
- Future-only accounting correction in this phase.
- Do not rewrite historical journal rows.
- Do not change physical inventory deduction quantities.
- Preserve branch isolation, Permission-First, Financial Visibility, POS settlement, Printing / Print Agent, KDS / Send to Kitchen, and shifts.
- Do not change purchase or stock-count accounting semantics.
- No merge or Production migration before exact-head Full Verify Green and explicit approval.

## Baseline
- Sample Production sale `Johna's-02118` posted COGS debit 82.71 and account 1200 credit 82.71.
- The same sale has raw-material inventory effects and no finished-product inventory effect.
- Last-30-day scan shows raw-material and inventory-unit sale effects; no product-target sale effects were observed.
- 1200 has accumulated negative balances in both active branches from sale/FIFO postings.
- Production remains unchanged for this repair.

## Root-cause ledger
1. `_process_sale_core` computes COGS from the actual inventory deduction result but posts the inventory side through semantic key `inventory_fg`.
2. FIFO sale-cost reconciliation functions also resolve `inventory_fg`.
3. Operational sale consumption is raw-material/inventory-unit based for the active restaurant model, so posting COGS against finished-goods account 1200 creates a false finished-goods balance.
4. Historical reconcile journals may already contain 1200; blindly switching their later updates to 1210 would mix accounts inside one historical reconciliation lifecycle.

## Change ledger
- Created `supabase/migrations/20261004133000_raw_material_cogs_accounting.sql`.
- Sale/refund/FIFO journal posting remaps `inventory_fg/1200` to `inventory_rm/1210`.
- New direct FIFO COGS reconciliation journals resolve `inventory_rm`.
- Existing FIFO reconciliation journals retain whichever inventory account they already contain.
- Purchase and stock-count references are not remapped.
- Added `tests/unit/rawMaterialCogsAccountingContract.test.ts`.
- Added `tests/integration/raw_material_cogs_accounting.test.ts` to prove sale remapping and purchase non-regression against a fresh DB.
- Updated `docs/CURRENT_WORK_PLAN.md` to this active branch and log.
- No historical backfill/reclassification is included.

## Verification ledger
- Production diagnosis: read-only evidence complete.
- Verify main #3716 / run `37205509405`: **FAILED only at mandatory active-worklog structure** before identity/API/lint/typecheck/unit/build/DB/browser checks.
- Worklog structure correction prepared after reading `tests/unit/activeWorklogGateContract.test.ts`.
- Added fresh-DB integration coverage after the worklog correction.
- Exact-head rerun on the latest implementation head: pending.

## Production gate
State: **BLOCKED**

No Production mutation is authorized by this worklog. A Production apply requires exact-head Full Verify Green, review of the final migration diff, and a separate explicit user approval.

## Next action
1. Commit this worklog gate correction.
2. Wait for exact-head Verify main.
3. If Green, review the migration and regression evidence.
4. Stop before Production and request explicit approval.
5. Keep historical 1200→1210 reclassification as a separate later task.

## Mandatory update protocol
- Before every repository write, verify the active branch HEAD and current `main`.
- Unexpected branch or main movement => **STOP_AND_RECONCILE**.
- Record each logical change in the Change ledger.
- Record every CI/verification run and result in the Verification ledger.
- Keep `docs/CURRENT_WORK_PLAN.md` pointing to this file while PR #445 is active.
- No Merge or Production migration until exact-head Full Verify is Green and explicit approval is recorded.
