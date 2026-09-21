# FIFO Cost Reconciliation — Plan, Work Log, and Continuation Memory

> **SOURCE OF TRUTH for this workstream**
>
> This document is the execution plan, live work log, and continuation memory for the FIFO raw-material costing repair.
> Any future continuation must start by reading this file and inspecting the current repository/database state. Do not rely on chat memory alone.

## Identity / Safety Lock

- Repository: `Premieros/johna-s`
- Development branch: `development/fifo-cost-reconciliation`
- Branch created from main HEAD: `eea177f893056ace796536fd6aa15075da25c58a`
- Production branch: `main`
- Production Supabase: `azzdesuowpdcoflmyezn`
- Do not touch any other repository or database.
- Do not modify `main` directly.
- No force push.
- Do not weaken RLS, permissions, or tests.
- Printing is out of scope and must not be changed.
- Do not change recipes, recipe quantities, product mappings, or stock quantities as part of this repair.
- No Production migration or backfill before Full Verify is green and the user gives explicit approval.

## User Decision

The required behavior is **real FIFO with negative-stock settlement and historical recalculation**, applied safely to all branches and to prior affected transactions.

The user explicitly does **not** want a simple estimated revaluation.

Required accounting behavior:

1. Raw-material sales may continue to go negative.
2. If a sale consumes more raw material than is available, create an oversold/debt quantity linked to the originating sale/production reference.
3. The oversold portion must not be finalized permanently at zero cost.
4. When a later positive receipt/purchase arrives for the same raw material + branch + warehouse, it settles the **oldest outstanding oversold debt first (FIFO)**.
5. The settling quantity inherits the actual FIFO receipt cost from the incoming batch.
6. Historical sale/production COGS must be adjusted by the settlement cost difference.
7. Accounting journal COGS/inventory amounts must be adjusted by the same delta so reports remain balanced.
8. Reports shown to users must reflect the corrected historical COGS after settlement.
9. Existing stock quantities must not be double-deducted or recreated by the recalculation.
10. Existing sales, recipes, payments, shifts, orders, and printing must remain unchanged by the costing repair.

## Root Cause Confirmed

Current canonical negative raw-material logic creates an oversold batch with:

- negative quantity,
- `unit_cost = 0`,
- `total_cost = 0`.

This is in the negative raw inventory migration and is the direct reason historical COGS becomes understated whenever sales run raw stock negative.

Current `_raw_add` simply inserts later positive stock as a new batch. It does **not** settle earlier oversold debt or recalculate the originating sale/production cost.

Therefore plain batch netting makes quantity correct, but FIFO historical cost remains wrong.

## Important Existing Contracts to Preserve

- Sale/kitchen raw-material negative stock remains allowed.
- Finished goods and manufactured-unit strict availability behavior must remain unchanged.
- Warehouse identity remains authoritative; no cross-warehouse or cross-branch fallback.
- `raw_material_inventory` is a branch aggregate compatibility summary; operational FIFO truth is in warehouse-aware raw material batches/ledger.
- Cost Center pricing helpers must not be used as a substitute for FIFO transaction valuation.
- The repair must work for all branches, not only Cleopatra.

## Current Cleopatra Audit Finding (Evidence Only — Do Not Hardcode)

The historical Cleopatra import exposed the issue clearly:

- Raw consumption recorded: ~6533.6323 units.
- ~4487.0371 units were posted at zero cost.
- Most zero-cost quantity came from oversold debt batches.
- Stored sale COGS therefore cannot be trusted as final FIFO cost while debt remains unsettled.

This dataset is only a regression case. The fix must be branch-agnostic and transaction-agnostic.

## Target Design

### A. Debt identity and settlement ledger

Introduce an explicit immutable link for every oversold quantity so later receipts can settle it deterministically.

Preferred approach:

- Keep existing negative oversold batches for stock quantity truth.
- Add a dedicated settlement table recording:
  - oversold batch id,
  - raw material,
  - branch,
  - warehouse,
  - original reference type/id/number,
  - original ledger movement,
  - debt quantity,
  - settled quantity,
  - settlement receipt/batch,
  - FIFO unit cost,
  - settlement value,
  - timestamps.
- Unique/idempotency constraints must prevent double settlement.

### B. Receipt behavior

Patch the canonical warehouse-aware `_raw_add` path safely:

1. lock raw material + branch + warehouse;
2. find outstanding oversold debts oldest first;
3. allocate incoming quantity to debt FIFO;
4. record settlement rows using the incoming batch cost;
5. only remaining receipt quantity becomes ordinary positive on-hand stock;
6. preserve the same net stock quantity as today;
7. trigger cost reconciliation for affected original references.

### C. Historical COGS reconciliation

For each settled debt amount:

- calculate delta = settled_qty × incoming FIFO cost minus any already-recorded cost for that debt portion;
- update/append auditable inventory valuation entries without rewriting unrelated inventory quantity;
- adjust originating sale/production COGS by delta;
- adjust matching journal entry COGS and inventory credit/debit by the same delta;
- preserve journal balance;
- preserve sale totals/payments/tax/discount.

Prefer additive correction entries over destructive rewriting where possible.

### D. Backfill for all prior affected data

Build an idempotent backfill that:

- scans every branch/warehouse/raw material independently;
- orders oversold debts by original FIFO time;
- orders later positive receipt batches by receipt/FIFO time;
- matches only receipts that are chronologically eligible after the debt;
- allocates FIFO deterministically;
- writes settlement rows and COGS/accounting deltas;
- never changes net stock quantity;
- never changes recipes;
- never replays sales;
- never queues printing;
- is safe to rerun.

Before Production:
- produce dry-run totals per branch,
- number of debts,
- matched quantity/value,
- unresolved debt quantity,
- affected sales/productions,
- accounting delta,
- zero-cost remainder.

## Required Tests

### Unit / Contract

- negative sale still succeeds;
- oversold debt is created with traceable origin;
- later receipt settles oldest debt first;
- two debts + one receipt settle in FIFO order;
- one debt + two receipts uses first receipt then second;
- partial settlement remains outstanding correctly;
- cross-branch isolation;
- cross-warehouse isolation;
- no double settlement on retry;
- no change to on-hand net quantity;
- no change to recipes/quantities;
- zero-cost receipt remains zero and is auditable, not silently invented;
- strict non-sale callers stay strict where currently required.

### Integration

- sale oversells raw stock;
- later purchase receipt settles debt;
- sale COGS increases by exact FIFO cost;
- journal COGS/inventory delta balances;
- reports return corrected COGS;
- manufactured-unit auto-production path also reconciles its raw oversold cost correctly;
- refund/void after reconciliation restores inventory and cost consistently;
- multiple branches remain isolated;
- backfill is idempotent.

### Regression

- POS sale still works.
- Send-to-kitchen flow still works.
- Current printing behavior unchanged.
- Purchase receiving unchanged except FIFO debt settlement.
- Stock count/transfer behavior unchanged.
- Fresh DB/schema verification green.
- Existing integration/security/RLS suite remains green.

## Rollback Strategy

Before any Production application:

1. record current migration HEAD and schema function definitions;
2. snapshot counts/sums for oversold batches, inventory ledger, sales COGS and journal entries;
3. backfill must have a batch/run id;
4. every reconciliation adjustment must be attributable to that run id;
5. rollback must reverse reconciliation accounting entries and settlement records without replaying stock quantity movements;
6. do not delete original source transactions.

## Execution Log

### 2026-09-21 — Audit / Plan

- Created development branch `development/fifo-cost-reconciliation` from main `eea177f893056ace796536fd6aa15075da25c58a`.
- Confirmed current oversold implementation stores debt at zero unit cost.
- Confirmed current `_raw_add` does not settle oversold debt.
- Confirmed user requirement: true FIFO settlement + historical recalculation across all prior affected transactions and all branches.
- No Production migration applied.
- No Production backfill applied.
- No printing code touched.
- No recipes or stock quantities changed by this workstream yet.

### 2026-09-21 — FIFO implementation / CI iteration

- Draft PR: #295 (`development/fifo-cost-reconciliation` -> `main`).
- First CI run #2205:
  - lint ✅
  - typecheck ✅
  - unit ✅
  - build ✅
  - Fresh DB/schema ✅
  - integration ❌ with three actionable failures.
- CI #2205 failures and fixes:
  1. `get_costing_sales_summary` temporarily lost the existing `history.unlimited` clamp contract -> restored `history_clamp_from/to`.
  2. legacy negative-cycle test expected aggregate average cost 9; true FIFO debt settlement leaves 2 receipt units at real cost 3 -> regression expectation updated to 3.
  3. new FIFO integration fixture duplicated auto-seeded account mappings -> fixture now reuses canonical seeded mappings.
- Historical read-only replay on Production (no writes) found:
  - 3,210 zero-cost oversold raw movements;
  - total oversold quantity 14,613.7341;
  - 1,000 historical consumption rows would change valuation under true FIFO;
  - net historical valuation delta observed in dry replay: ~21,401.50;
  - 10,692.0107 quantity remains unresolved because no later receipt exists yet;
  - 13 affected historical purchase-return movements were discovered and are now explicitly supported.
- Production ledger/batch integrity check:
  - 11,890 raw ledger rows;
  - 0 missing batch numbers;
  - 0 ledger rows without matching batch;
  - 0 duplicate batch matches;
  - 0 aggregate ledger-vs-batch quantity mismatches.
- Added historical backfill migration `20260921183000_raw_fifo_historical_backfill.sql`:
  - prepare/apply split; migration never auto-runs the backfill;
  - immutable run/plan/allocation/batch-target records;
  - stale-ledger and changed-batch guards before apply;
  - deterministic debt-first + FIFO receipt replay;
  - signed valuation deltas;
  - purchase-return valuation support;
  - net stock quantity invariant;
  - idempotent already-applied behavior.
- Added unit backfill contract test and integration backfill safety/idempotency test.
- Added signed-delta handling so historical FIFO can both raise and lower costs safely.
- Added guards preventing corrected sale/production/kitchen cost from falling below zero.
- Added temp-table cleanup so prepare can be rerun safely inside one test transaction.
- Current verification run after these fixes: CI #2214 (pending at time of this log update).
- Production remains unchanged: no FIFO migration, no historical backfill, no printing changes.

### 2026-09-21 — Emergency rollback point locked

- Exact pre-FIFO Production code point: `0559ec7e0bc21524cc029bc00055928837a7cd6d`.
- Dedicated rollback branch created:
  - `rollback/pre-fifo-20260921-1829`.
- This rollback point includes the current approved unified thermal printing design from PR #294.
- Exact pre-FIFO Production database definitions were captured for:
  - warehouse-aware `_raw_add`;
  - warehouse-aware `_raw_remove_fifo`;
  - `get_costing_sales_summary`;
  - `get_order_margin`.
- Emergency database behavior restore package:
  - `supabase/rollback/20260921_pre_fifo_emergency_restore.sql`.
- The rollback SQL lives outside `supabase/migrations` and therefore can never auto-run.
- Emergency restore does not touch:
  - printing tables/functions/queues;
  - sales/orders/payments;
  - recipes;
  - stock movement rows.
- FIFO audit tables are intentionally left intact during emergency behavior rollback so rollback itself is non-destructive and auditable.
- **Hard gate added:** historical Production backfill MUST NOT be applied until a tested backfill reversal path exists. Code/function rollback alone is not considered sufficient after a historical backfill mutates valuation data.
- Production remains unchanged by FIFO work at this point.

### 2026-09-21 — Production dry-run replay (no persistent writes)

- Replayed historical raw FIFO on Production inside a rollback-only transaction.
- No persistent Production data was changed.
- Current dry-run impact by branch:
  - Cleopatra:
    - consumption rows scanned: 1,562;
    - changed valuation rows: 137;
    - positive-delta rows: 88;
    - negative-delta rows: 49;
    - net valuation delta: +329.74;
    - absolute valuation movement: 1,420.31;
    - unresolved FIFO debt quantity: 4,581.6495 across 688 debt rows.
  - Smouha Club:
    - consumption rows scanned: 7,644;
    - changed valuation rows: 864;
    - positive-delta rows: 816;
    - negative-delta rows: 48;
    - net valuation delta: +21,059.25;
    - absolute valuation movement: 22,572.64;
    - unresolved FIFO debt quantity: 6,141.5936 across 2,396 debt rows.
- Current combined changed rows: 1,001.
- Current combined net valuation delta: +21,388.99.
- Current combined unresolved debt quantity: 10,723.2431.
- Changed references by type:
  - direct sale: 45 rows, +15,216.39 net delta;
  - kitchen_send: 907 rows, +6,087.99 net delta;
  - purchase_return: 13 rows, -31.75 net delta;
  - production: 36 rows, +116.84 net delta.
- These numbers are a point-in-time dry-run and must be regenerated immediately before any Production apply because live branches continue moving.
- Workflow #2221 started after the latest test fix and is still running at this log update.
- Production still has no FIFO migration/backfill applied.

### 2026-09-21 — Full Verify green with tested reversal

- Workflow #2227 completed successfully on commit `af0ad2b47252ccaa5b81a87b869f0df5cc7baa9a`.
- verify: GREEN (lint, TypeScript, unit, build).
- db: GREEN (canonical migrations, schema, integration, security/RLS).
- browser-smoke: GREEN.
- Historical backfill reversal is now covered by integration tests:
  - apply -> reverse restores pre-backfill raw ledger valuation and batch residual quantities;
  - reconciliation accounting artifacts are removed when their net delta returns to zero;
  - a repeated reverse is idempotent;
  - stale reversal is blocked after newer raw-material movement.
- Production remains unchanged by FIFO migrations/backfill at this point.
- The emergency pre-FIFO rollback branch/package remains available.
- Next gate: refresh Production preflight/dry-run against the live ledger immediately before any approved Production apply.

## Next Steps

1. Design additive schema for FIFO debt settlement/reconciliation.
2. Implement migration on this development branch only.
3. Add unit/integration/backfill-idempotency tests.
4. Run Full Verify.
5. Produce Production dry-run impact report for all branches.
6. Stop and request explicit user approval before Production migration/backfill.
