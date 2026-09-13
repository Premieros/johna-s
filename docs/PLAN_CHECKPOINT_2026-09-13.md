# Plan Checkpoint — 2026-09-13

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Production branch: `main`
Baseline for this checkpoint: `main@a7abca8f0dd020f957b7abe9c084c35d1e4a51bd`

This checkpoint records the actual repository state after the latest merged work. It exists because the status header in `docs/CURRENT_WORK_PLAN.md` still reflects an older Catalog checkpoint and must not be used alone to infer current completion state.

## Closed and merged

### Backend Simplification Program
- PR1 — Architecture / Simplification Map: CLOSED + MERGED.
- PR2 — Inventory Contracts: CLOSED + MERGED.
- PR3 — Catalog: CLOSED + MERGED as completed sub-stages:
  - 6A — canonical create contracts: CLOSED.
  - 6B — centralized `product_unit_links` writes: CLOSED.
  - 6C — proven dead Catalog wrappers removed: CLOSED.
  - 6D — current direct Catalog RPC calls centralized behind `src/api`: CLOSED via PR #95.

### Related merged stabilization work
- Negative raw-material sell-through backend guard: merged.
- POS raw-shortage UI guard: merged.
- Purchase invoice editing + inline raw creation: merged.
- Purchase warehouse identity repair: merged.
- Raw FIFO overload ambiguity repair: merged.
- Credit purchase normalization: merged.
- Supplier statement real-payment correction: merged.
- Kitchen ticket quantity/layout fix: merged.

## Current main verification

The latest merged Catalog 6D state is on `main@a7abca8f0dd020f957b7abe9c084c35d1e4a51bd`.
Post-merge Verify and GitHub Pages Deploy completed successfully for that head.

## Remaining main program stages

### PR4 — Purchases End-to-End
Goal: close the complete procurement/purchase lifecycle rather than isolated screens.

Required proof includes:
- request -> submit -> approval/reject -> PO/RFQ where applicable -> receive -> inventory/ledger -> supplier/account impact;
- branch + warehouse isolation;
- partial receive/backorder behavior;
- duplicate receive protection;
- cancellation/reversal contract;
- invoice correction without stacking stock/accounting impact;
- user-facing actions are complete, reachable, and clearly labeled.

### PR5 — Sales / POS / Tables / Kitchen / Payments
Required proof includes:
- granular permissions including view-only and pay-only;
- order create/edit/hold/resume;
- dine-in/table ownership and acting-user identity where relevant;
- send-to-kitchen first-send once, modifications as delta only, retry without repeated deduction;
- raw shortages remain sellable and deduct into negative at kitchen send;
- ready/manufactured/configuration errors remain correctly blocking;
- payment idempotency;
- receipt/print permission contract;
- no misleading fatal-looking warning for non-blocking conditions;
- all required actions have clear UI entry points.

### PR6 — Shift / Finance / Reports
Required proof includes:
- open/close shift and opening balance;
- sales totals by shift and by user;
- payment totals match order totals;
- day close and report sources are consistent;
- branch-scoped accounting and reporting;
- supplier/customer/account impacts reconcile to the underlying transactions;
- reporting UI remains compact and understandable;
- unclear or duplicated filters/actions are consolidated without losing capability.

### PR7 — Confirmed Legacy Cleanup
Only remove legacy code after:
`usage proof -> replacement proof -> regression coverage -> removal -> Full Verify`.

No feature may be deleted merely because it appears old. Working user-visible behavior is preserved unless a distinct approved replacement exists.

## Separate active track

### Premier Print Agent — PR #78
Status: OPEN / DRAFT / NOT MERGED.

It remains separate from the simplification stages. Its Production migration is not approved for application merely by this checkpoint; it must satisfy its own verification, Windows artifact, routing, idempotency, and print-truth gates before merge/deploy.

## Standing execution condition

All remaining stages may proceed under `docs/EXECUTION_GUARDRAILS.md`.
The central condition is preservation of existing user data and working configuration, plus a mandatory UX review for every touched workflow.

No stage is closed merely because code compiles. It must be functionally proven, regression-safe, UX-complete for its touched surfaces, and Full Verify Green.