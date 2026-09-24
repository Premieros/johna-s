# Opening FIFO cost repair follow-up — 2026-09-24

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/opening-fifo-transfer-followup-20260924`
Current PR: `#356`
Last updated: 2026-09-24 23:39 Africa/Cairo
State: **BLOCKED**

## Work status
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
- PR #314 correctly repairs zero-cost opening receipts and delegates historical valuation to the FIFO backfill.
- FIFO backfill intentionally rejected changed reference types outside sale/kitchen_send/production/purchase_return.
- A new raw-material warehouse transfer was created after the original repair design.
- The transfer inherited zero cost from the unrepaired Smouha opening lot.
- Therefore the opening repair now reaches a legitimate `warehouse_transfer` changed reference and stops at the safety guard.

## Change ledger
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
