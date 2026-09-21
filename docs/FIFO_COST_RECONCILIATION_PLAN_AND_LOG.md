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

## Next Steps

1. Design additive schema for FIFO debt settlement/reconciliation.
2. Implement migration on this development branch only.
3. Add unit/integration/backfill-idempotency tests.
4. Run Full Verify.
5. Produce Production dry-run impact report for all branches.
6. Stop and request explicit user approval before Production migration/backfill.
