# Opening FIFO cost repair follow-up — 2026-09-24

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/fifo-opening-repair-final-20260925`
Current PR: `#356`
Last updated: 2026-09-25 01:48 Africa/Cairo
State: **BLOCKED**

## Work status
- Final integration branch rebuilt from current `main@c4178c9bcdf662bdffceb855e2d2398b12200f51` after old PR #356 closed unmerged and its branch diverged from main.
- Only the scoped FIFO migrations/tests/log changes are carried forward; overlapping current-main content is reconciled instead of overwritten.
- Code follow-up is implemented on the development branch only.
- Production remains unchanged.
- Current gate: exact-head Full Verify must be Green before asking for Production approval.
- This work completes the blocked PR #314 opening-inventory FIFO repair path.

## Guardrails
- Do not modify `main` directly.
- Do not apply Production migrations or run the Production repair before exact-head Full Verify Green + explicit approval.
- Do not touch printing, Print Agent, routing, KDS, or send-to-kitchen.
- Preserve physical stock quantities exactly.
- Preserve Permission-First and branch isolation.
- Fail closed on ambiguous transfer identity or downstream destination consumption.

## Baseline
- Smouha opening repair prepare: 162 zero-cost opening batches; 140 eligible; 22 unresolved/review-only.
- Historical replay blocker: inventory_ledger `19086`.
- Reference type: `warehouse_transfer`.
- Transfer: `Johna's-00002` / `e406a708-6d74-4510-8dc3-bdbd12427694`.
- Source: Smouha / raw `اعشاب عدد 1 باكت` / quantity 1 / unit_cost 0.
- Destination: Cleopatra / raw `91d22332-0087-429c-b0cd-93d47f7e5ede` / quantity 1 / unit_cost 0.
- Destination transfer lot had no downstream negative ledger consumption at inspection time.
- Existing PR #314 repair itself remains the canonical opening-cost repair.

## Root-cause ledger
- Opening-cost apply after the historical-debt rebase migration stopped safely at source ledger `1881`: `FIFO_SALE_NOT_FOUND`.
- Ledger 1881 belongs to deleted sale id `89fbcb31-fb02-4d1f-b726-9aaad1925a10` / invoice `Johna's-00009`; its original sale journal survives.
- Opening-plan scope contains exactly two orphan sale references tied to eligible opening batches: `Johna's-00009` and `Johna's-00010`.
- Both have exactly one surviving base sale journal, zero existing FIFO reconcile journals, and zero normal `raw_fifo_sale_cogs_adjustments` rows.
- The old orphan fallback covered missing kitchen events and purchase returns but did not cover deleted sale headers.
- Required handling is accounting-backed, not ledger-only: preserve the original sale journal, post FIFO cost changes in a separate reversible reconcile journal, and fail closed on ambiguous/mixed state.

- Production apply attempt after warehouse-transfer support stopped safely at `FIFO_BACKFILL_EXISTING_DEBT_MISMATCH`.
- Exact mismatch: source ledger `3611` / raw `عيش توست عدد`; old historical debt = 56, replay target debt = 6; both fully settled.
- Production scope check: 4,525 existing FIFO debts in Smouha, zero target-zero legacy debts, exactly one nonzero debt mismatch.
- The old debt belongs to historical backfill `ce72c9e6-3ab0-4eaa-aac8-0642d24175c7`, not live-created debt.
- Old settlements on ledger 3611 consumed later receipt capacity; current replay reallocates those receipts to later debts/FIFO. Therefore changing only the debt quantity is unsafe.
- Required follow-up: audited, reversible debt settlement rebase that snapshots the old debt + all settlement rows, replaces only fully-settled historical backfill-owned mismatch state with current replay target, and restores the snapshot on backfill reversal.

- PR #314 correctly repairs zero-cost opening receipts and delegates historical valuation to the FIFO backfill.
- FIFO backfill intentionally rejected changed reference types outside sale/kitchen_send/production/purchase_return.
- A new raw-material warehouse transfer was created after the original repair design.
- The transfer inherited zero cost from the unrepaired Smouha opening lot.
- Therefore the opening repair now reaches a legitimate `warehouse_transfer` changed reference and stops at the safety guard.

## Change ledger
- Added migration `20260925005500_raw_fifo_orphan_sale_journal_fallback.sql`.
- Added internal table `raw_fifo_orphan_sale_cogs_adjustments` without a foreign key to `sales`, because the historical sale header is intentionally absent.
- Added `_fifo_adjust_orphan_sale_cogs_delta`: requires a missing sale header and exactly one surviving base sale journal, validates account mappings and non-negative resulting COGS, preserves the base journal, and creates/updates a separate `fifo_cogs_reconcile` entry.
- Signed reverse deltas reduce the orphan adjustment back to zero, delete the reconcile journal, and leave the historical base journal unchanged.
- The sale branch of `_fifo_adjust_reference_delta` still uses the canonical sale helper when the sale exists; it uses the orphan helper only when the sale header is missing.
- Added unit contract coverage plus an integration apply/reverse test.

- Added migration `20260925000500_raw_fifo_historical_debt_rebase.sql`.
- Added internal snapshot tables for original debt state and settlement rows.
- Added `_raw_fifo_rebase_historical_debt_state`: identifies only replay/current settlement-map differences, refuses live debts, refuses partially settled debts, refuses target debt growth, snapshots exact state, deletes only affected settlement rows, and updates affected historical debt quantities to replay target.
- Added `_raw_fifo_restore_rebased_debt_state`: restores original debt quantities/provenance and exact settlement IDs/receipt links/quantities/run IDs during backfill reversal.
- `raw_fifo_apply_backfill` now invokes the rebase before historical debt materialization; `raw_fifo_reverse_backfill` restores snapshots after current-run settlements are removed.
- Added unit contract coverage and integration coverage for apply -> rebuilt settlement map -> reverse -> exact old settlement restoration.

- Added migration `20260924223500_raw_fifo_warehouse_transfer_cost_propagation.sql`.
- Added internal helper `_fifo_adjust_warehouse_transfer_delta`.
- Added `warehouse_transfer` to the historical FIFO changed-reference allow-list.
- Current Production `_fifo_adjust_reference_delta` definition is preserved and extended with the transfer handler.
- Helper updates valuation only: destination transfer ledger total/unit cost, exact destination raw batch unit cost, transfer-item unit cost, and destination raw avg-cost cache.
- Helper never updates quantity.
- Helper rejects non-raw targets, wrong branch/warehouse scope, ambiguous item/ledger/batch identity, negative resulting valuation, and any downstream consumption.
- Added unit contract test `raw_fifo_warehouse_transfer_cost_propagation.test.ts`.
- Printing-related files/functions are untouched.

## Verification ledger
- Full Verify on `1ff4dc50a12b6db53e70ddd7cad546cf66ae0d42`: verify Green, DB/integration/RLS Green, Browser Smoke Green.
- Production migration `raw_fifo_historical_debt_rebase` applied successfully.
- Fresh Smouha opening prepare run `a353dfea-b47e-40c7-be07-effe22c47e21`: 162 opening batches; 140 eligible; 22 unresolved; candidate opening value 129389.08.
- Its apply stopped transactionally at orphan sale ledger 1881; no partial opening/FIFO data change persisted.
- Orphan-sale fallback Fast Verify DB path Green, including changed integration test and canonical migration apply.
- First Fast Verify app path failed only because the new unit immutability assertion used an over-broad cross-file regex; code/integration behavior was Green.
- The assertion was narrowed to reject the actual forbidden base-journal update predicate directly.
- Exact-head verification after unit-contract correction: pending.

- Full Verify on `1ff4dc50a12b6db53e70ddd7cad546cf66ae0d42`: verify Green, DB/integration/RLS Green, Browser Smoke Green.
- Production migration `raw_fifo_historical_debt_rebase` applied successfully.
- Fresh Smouha opening prepare run `a353dfea-b47e-40c7-be07-effe22c47e21`: 162 opening batches; 140 eligible; 22 unresolved; candidate opening value 129389.08.
- Its apply stopped transactionally at orphan sale ledger 1881; no partial opening/FIFO data change persisted.
- Orphan-sale journal fallback code and tests now committed on the same development branch.
- Exact-head Full Verify after orphan-sale fallback: pending.

- Exact-head Full Verify on `fa9b17b1efb5bc53c22adbf0541019b83b2a8ec5`: verify job Green; DB integration still failed because the first midnight-fixture correction anchored sales at 12:00 Cairo, which is future time just after midnight and outside report `now() ± 2h` windows.
- New FIFO rebase integration test remains Green.
- Reporting fixture corrected again to use the database `now()` timestamp itself. This keeps fixture rows in the current Cairo business date and inside the report windows at all times, including midnight.
- No production reporting logic changed.
- Full Verify after database-clock fixture correction: pending.

- Exact-head Full Verify on `b4086756549f16b368024851b11620f258aa139e`: verify job Green; DB integration failed twice on one unrelated midnight-boundary test in `reporting_truth_reconciliation.test.ts`.
- New FIFO rebase integration test passed in both DB attempts.
- Root cause of reporting failure: fixture used `Date.now() - 30m`, which crossed into the previous Cairo business date just after local midnight while the day-close report queried the new Cairo date.
- Test fixture corrected to anchor shift/sales to 11:00/12:00 on the current Cairo business date; no production report logic changed.
- Full Verify after Cairo-date fixture correction: pending.

- Production diagnostic replay `f6bcfee7-f0c0-49fe-b0aa-6a885b0030fd` found 4,525 existing Smouha debts, zero target-zero legacy debts, and exactly one debt-quantity mismatch.
- Full settlement-map comparison: 1,942 relations unchanged; 16 current-only, 15 target-only, 1 quantity mismatch.
- Those differences affect exactly 14 debts; all 14 are older-backfill-owned, all 14 are fully settled currently, and all 14 are fully settled in target replay; only ledger 3611 changes total debt quantity.
- Follow-up code + tests committed on the development branch.
- Exact-head Full Verify after historical-debt rebase change: pending.

- PR #356 opened against `main`.
- First Full Verify run `36054555738`: failed only at mandatory active-worklog gate because the unified plan still pointed to the completed performance branch.
- Follow-up commit updated the unified plan and this mandatory log to the current branch/PR.
- No Production SQL write has been performed.
- Exact-head Full Verify run `36054803170`: failed only because `activeWorklogGateContract.test.ts` was still hard-coded to the completed performance log path; structural log checks and PR-branch match passed.
- Gate contract has now been updated to the current FIFO worklog path.
- Exact-head Full Verify run `36054954504`: GREEN — verify, DB migrations/schema/integration/RLS, and browser-smoke all succeeded.
- Production read-only pre-apply recheck: destination transfer lot downstream negative rows = 0.
- Production read-only pre-apply recheck: Smouha zero-cost operating consumption rows = 5,971 across 149 raw materials.
- Previous FIFO/opening repair runs remain `prepared` only; none were applied.
- Because live inventory advanced after the old prepare cutoffs, old prepared runs must not be reused; a fresh prepare is required immediately before apply.
- Exact-head Full Verify after recording these verification facts: pending.

## Production gate
State: **BLOCKED**
- Full Verify exact-head Green: previous code head Green at run `36054954504`; final documentation-only head reverify pending.
- Production migration approval: not yet requested.
- Production repair execution approval: not yet requested.
- Required pre-apply read-only recheck: destination transfer lot must still have zero downstream consumption.
- Required post-apply checks: quantity invariants, opening batch valuation, FIFO run success, trial balance, raw inventory valuation, COGS reconciliation, and zero-cost consumption count.

## Next action
1. Implement audited/reversible historical debt rebase on the same branch.
2. Restrict automatic rebase to prior-backfill-owned debts where current debt is fully settled, target debt is fully settled, and target debt is positive and no larger than current debt.
3. Add integration coverage for snapshot -> rebase -> restore.
4. Run exact-head Full Verify.
5. Only after Green, apply the follow-up migration to Production and rerun a fresh Smouha opening-cost prepare/apply.
1. Wait for exact-head Full Verify on this documentation-only head.
2. If Green, present the exact Production migration/backfill sequence and request explicit Production approval.
3. Only after approval: apply the migration, perform a fresh Smouha opening-cost prepare, inspect its generated FIFO dry-run, apply only if guards remain Green, then verify quantity/accounting invariants.
4. Never reuse the stale prepared runs created before the latest live ledger activity.

## Mandatory update protocol
- Read this file before every new change in this workstream.
- Update `Change ledger` after each code/schema change.
- Update `Verification ledger` after every CI/test/run result.
- Keep `Production gate` at **BLOCKED** until exact-head Full Verify is Green and explicit Production approval is recorded.
- If any unexpected inventory, accounting, printing, or branch-isolation behavior appears, stop and do not merge or apply Production changes.
