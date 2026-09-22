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
- created no raw batches, inventory entries, ledger entries, stock transactions or stock movements.

Therefore the defect is a historical header identity error, not a stock-quantity defect.

Repair in this branch:
- reassign only the audited 12 purchase headers to Smouha default warehouse;
- abort if any receipt/stock effect or changed assumption is detected;
- do not touch stock quantities, FIFO or accounting values.

### B. 4 fully-voided zero-value order shells remain open

The four audited orders:
- have no current order items or kitchen-send snapshot;
- are unpaid;
- have zero net kitchen inventory quantity after voids;
- have no shift/accounting/stock reference;
- predate or fell outside the current fully-voided-order auto-close path.

Repair in this branch:
- mark only those four shells cancelled;
- align kitchen status to cancelled;
- preserve historical notes and append a system retirement marker;
- keep table safety guard so another live order can never be freed.

## Findings deliberately NOT treated as corruption

- Simple historical sales without `sale_payments` detail rows are valid: reports intentionally fall back to `sales.paid_amount/payment_method`.
- Cleopatra business date `2026-09-23` is intentional after an explicit rollover that closed business day 22 while preserving the shift.
- Historical settled kitchen event totals can differ from the current send snapshot after void/resend cycles; live/unsettled overage is the actionable invariant.
- Negative raw batches are expected debt under the approved negative-raw sell-through contract.

## Next gates

1. Focused contract test.
2. Full Verify on exact branch HEAD.
3. Review migration diff and re-query Production assumptions read-only.
4. No Production migration until Full Verify Green and explicit approval.
5. After data repair is proven, proceed to low-risk project cleanup/dead-path reduction separately.
