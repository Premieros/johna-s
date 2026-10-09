# RAW MATERIAL COGS ACCOUNTING — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/raw-material-cogs-main-sync-20261009`
Current PR: `#479` (supersedes stale #445)
Last updated: 2026-10-04

## Work status

Reconciled against merged reporting baseline `7df65dd0`; source accounting logic and focused tests ported from PR #445. This work remains draft until exact-head Full Verify passes. No Production changes.
State: **IN VERIFICATION — production apply blocked**

Implementation is on a Draft PR and is not applied to Production. Exact-head Full Verify must be Green and Production requires separate explicit approval.

## Guardrails
- Future-only accounting correction in this phase.
- Do not rewrite historical journal rows.
- Do not change physical inventory deduction quantities.
- Preserve branch isolation, Permission-First, Financial Visibility, POS settlement, Printing / Print Agent, KDS / Send to Kitchen, and shifts.
- Do not change purchase or stock-count accounting semantics.
- A refund must reverse the same inventory account used by the original sale.
- A FIFO COGS reconciliation must follow the base sale journal and must not switch an existing reconciliation journal between 1200 and 1210.
- No merge or Production migration before exact-head Full Verify Green and explicit approval.

## Baseline
- Sample Production sale `Johna's-02118` posted COGS debit 82.71 and account 1200 credit 82.71.
- The same sale has raw-material inventory effects and no finished-product inventory effect.
- Last-30-day scan shows raw-material and inventory-unit sale effects; no product-target sale effects were observed.
- 1200 has accumulated negative balances in both active branches from sale/FIFO postings.
- Manual/auto `inventory_unit` production changes operational stock but does not post a finished-goods GL entry; therefore active restaurant unit consumption must not create a synthetic finished-goods credit.
- Explicit product production does post raw -> WIP -> finished goods, so true ready-product sales must retain finished-goods accounting.
- Production remains unchanged for this repair.

## Root-cause ledger
1. `_process_sale_core` computes COGS from the actual inventory deduction result but posts its inventory side through semantic key `inventory_fg` regardless of whether the sale consumed raw materials, inventory units, or a true ready product.
2. Active restaurant sales currently consume raw materials / operational inventory units, while no product-target sale effect was found in the 30-day Production scan.
3. Operational `inventory_unit` production has no matching finished-goods GL capitalization, so crediting 1200 when those units are sold creates a false negative finished-goods balance.
4. Explicit ready-product production does capitalize finished goods and therefore must not be remapped blindly to raw materials.
5. Refund code emits `inventory_fg` regardless of whether the original sale journal used 1200 or 1210, so a blanket refund remap would incorrectly alter historical-sale reversals.
6. FIFO sale-cost reconciliation originally resolves `inventory_fg` directly; historical and future adjustments must instead follow the inventory account used by the base sale journal.
7. Existing reconciliation journals must retain their current inventory account when later deltas update them.

## Change ledger
- Created `supabase/migrations/20261004133000_raw_material_cogs_accounting.sql`.
- Rebuilt the migration from current Production function definitions after review; no patch-on-patch function body remains.
- Sale posting remaps `inventory_fg/1200` to `inventory_rm/1210` only when the sale has no `sale_item_inventory_effects.target_type='product'`.
- A sale with an explicit ready-product effect keeps finished-goods accounting.
- Refund posting resolves the original sale journal by branch/reference number and reverses whichever of 1200/1210 that sale actually used.
- Live and orphan FIFO COGS reconciliation derive their inventory account from the base sale journal.
- Existing FIFO reconciliation journals retain whichever inventory account they already contain.
- Purchase and stock-count references are not remapped.
- Added `tests/unit/rawMaterialCogsAccountingContract.test.ts`.
- Added `tests/integration/raw_material_cogs_accounting.test.ts` for raw-sale routing, direct 1200 compatibility, new-sale refund lineage, historical 1200 refund lineage, and purchase non-regression.
- Added `scripts/accounting/rollback_raw_material_cogs_accounting.sql` from the pre-change Production function definitions; rollback changes function routing only and never rewrites journal history.
- Updated `docs/CURRENT_WORK_PLAN.md` to the refined accounting-lineage contract.
- No historical backfill/reclassification is included.

## Verification ledger
- Production diagnosis: read-only evidence complete.
- Verify main #3716 / run `37205509405`: **FAILED only at mandatory active-worklog structure** before identity/API/lint/typecheck/unit/build/DB/browser checks.
- Mandatory active-worklog structure was corrected.
- Initial broad remap was reviewed and rejected before Production because it would have changed historical-refund lineage and ignored true ready-product accounting.
- Refined migration and refund/FIFO lineage integration coverage are now committed.
- Verify main #3726 / run `37206832792`: verify job **GREEN** (worklog, project identity, API contract, lint, typecheck, unit, build); DB job failed while applying canonical migrations before schema/integration because the generated PL/pgSQL function definitions were missing statement terminators between definitions.
- Migration and rollback scripts were corrected to terminate all three function definitions explicitly.
- Verify main #3729 / run `37207181937`: verify job **GREEN**; canonical migrations + schema **GREEN**; DB regression reached integration and failed only in legacy FIFO expectations.
- Root cause of the FIFO failures was split:
  - normal sale FIFO can settle before the base sale journal exists, so account lineage needs a narrow pre-journal fallback;
  - orphan-sale test still asserted `inventory_fg` even though its base sale is now created through the new routing and therefore uses `inventory_rm`.
- Added pre-journal FIFO account inference: explicit product effect -> `inventory_fg`, otherwise `inventory_rm`.
- Updated the orphan FIFO test to assert the new base-sale account lineage and added a unit contract for the pre-journal fallback.
- Exact-head Full Verify after these FIFO compatibility fixes: pending.

## Production gate
State: **BLOCKED**

No Production mutation is authorized by this worklog. A Production apply requires exact-head Full Verify Green, review of the final migration diff, and a separate explicit user approval.

## Next action
1. Run exact-head Verify main on the latest refined head.
2. If Green, inspect integration + DB + Browser Smoke results and final PR diff.
3. Confirm no Production parity issue from the new migration filename/version.
4. Stop before Production and request explicit approval.
5. Keep historical 1200→1210 reclassification as a separate later task.

## Mandatory update protocol
- Before every repository write, verify the active branch HEAD and current `main`.
- Unexpected branch or main movement => **STOP_AND_RECONCILE**.
- Record each logical change in the Change ledger.
- Record every CI/verification run and result in the Verification ledger.
- Keep `docs/CURRENT_WORK_PLAN.md` pointing to this file while PR #445 is active.
- No Merge or Production migration until exact-head Full Verify is Green and explicit approval is recorded.
