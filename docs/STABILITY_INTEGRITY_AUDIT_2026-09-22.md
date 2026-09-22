# Stability / Integrity Audit — 2026-09-22

Branch: `development/stability-integrity-repair-20260922`  
Base: `main@6838b23c310616a95e3b7235f624b8f2af22c779`  
Production DB inspected read-only: `azzdesuowpdcoflmyezn`  
Printing / Print Agent / routing: untouched  
Production writes: none

## Objective

Operate as a stability monitor and critical-repair track covering:
- business-function correctness;
- data integrity and branch/warehouse isolation;
- inventory consumption / reversal / FIFO consistency;
- shift/day/report boundaries;
- UX/runtime regressions that block work;
- stale operational data and repository cleanup only after correctness is restored.

## Verified healthy invariants

- No duplicate open shifts per branch.
- No expense/shift branch mismatch.
- No order/sale inventory-warehouse branch mismatch.
- No raw warehouse inventory branch mismatch.
- No kitchen-send branch mismatch.
- No kitchen inventory event/effect branch or warehouse mismatch.
- No sale-item inventory effect branch/warehouse mismatch.
- No kitchen sent quantity greater than current order-item quantity.
- Split-tender rows reconcile to sale headers for every sale that has tender-detail rows.
- Returned sale lines have no negative/over-refunded quantities or amounts.
- Raw warehouse inventory quantity exactly matches raw batch quantity for all 515 audited raw/branch/warehouse tuples.
- FIFO stock-adjustment reconciliation has zero pending delta.
- Kitchen inventory event total_cost reconciles to event effects.
- Negative raw batches remain allowed inventory debt by the established sell-through contract.

## Confirmed historical defects

### A. 12 Smouha purchase headers reference Cleopatra warehouse

All 12:
- belong to Smouha;
- contain Smouha raw materials;
- point to Cleopatra Main warehouse;
- have `received_quantity = 0`;
- have no GRN;
- created no raw batches, inventory entries, ledger entries, stock transactions or stock movements.

Therefore the defect is a historical header identity error, not a stock-quantity defect.

Repair in this branch:
- reassign only the audited 12 purchase headers to Smouha default warehouse;
- abort if any receipt/stock effect or changed assumption is detected;
- do not touch stock quantities, FIFO or accounting values.

### B. 4 fully-voided stale order shells remain open

The four audited orders:
- have no current effective order items or kitchen-send snapshot;
- are unpaid and have no payment timestamp;
- have zero net kitchen inventory quantity after voids;
- have no shift/accounting/stock reference;
- retain stale header state/totals on three rows even though all effective items are gone;
- predate or fell outside the current fully-voided-order auto-close path.

Repair in this branch:
- mark only those four shells cancelled;
- zero stale subtotal/total header values;
- align kitchen status to cancelled;
- preserve historical notes and append a system retirement marker;
- keep table safety guard so another live order can never be freed.

## Findings deliberately NOT treated as corruption

- Simple historical sales without `sale_payments` detail rows are valid: reports intentionally fall back to `sales.paid_amount/payment_method`.
- Cleopatra business date `2026-09-23` is intentional after an explicit rollover that closed business day 22 while preserving the shift.
- Historical settled kitchen event totals can differ from the current send snapshot after void/resend cycles; live/unsettled overage is the actionable invariant.
- Negative raw batches are expected debt under the approved negative-raw sell-through contract.

## Verification

Exact repair head before this documentation update: `ecea5aecd792200e5c278732c3c80a22e1c441fb`.

GitHub Actions run `35696371462` — Full Green:
- application verify: ✅
  - locked Supabase identity
  - frontend API contract
  - lint
  - TypeScript
  - application/test-suite typecheck
  - unit tests
  - build
- DB verification: ✅
  - canonical migrations on fresh PostgreSQL
  - schema verification
  - integration + security/RLS regression
- Browser Smoke / Playwright Chromium: ✅

Production assumptions were re-queried read-only after Full Green:
- all 12 purchase headers are still Smouha rows pointing at Cleopatra warehouse;
- all 12 still have received quantity 0, returned quantity 0, and no GRN;
- all 4 stale orders remain open/unpaid with 0 effective items, 0 effective send snapshot, 0 net kitchen inventory quantity, 0 shift refs and 0 journal refs.

## Gate status

- Focused contract: ✅
- Full Verify: ✅
- Fresh DB/schema: ✅
- Integration/security/RLS: ✅
- Browser Smoke: ✅
- Production assumptions re-checked read-only: ✅
- Printing/KDS/Print Agent touched: ❌
- Production migration applied: ❌
- Merge: pending explicit approval / final main-head recheck.
- Production migration: pending explicit approval after merge and final pre-apply dry-run.
