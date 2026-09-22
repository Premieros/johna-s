# Stability / Integrity Audit — 2026-09-22

Branch: `development/stability-integrity-repair-20260922-v2`  
Base: `main@3b994c4fa20e97fd909e9ec565eeab3ac04b159a`  
Production DB inspected read-only: `azzdesuowpdcoflmyezn`  
Printing / Print Agent / routing: untouched  
Production writes: none

## Confirmed scope

1. 12 Smouha purchase headers historically point to Cleopatra Main warehouse.
   - Purchase branch and raw-material branch are Smouha.
   - received quantity = 0.
   - returned quantity = 0.
   - no GRN.
   - no raw batches, inventory ledger, inventory entries, stock movements or stock transactions were created from these purchases.
   - Repair changes only the purchase header warehouse to Smouha default warehouse and aborts on any changed assumption.

2. 4 fully-voided stale order shells remain open.
   - unpaid, no payment timestamp.
   - no effective order items.
   - no positive kitchen-send snapshot.
   - net kitchen inventory quantity = 0.
   - no shift or journal references.
   - three retain stale header totals even though all effective items are gone.
   - Repair cancels only these audited shells, zeroes stale totals, preserves notes, and never frees a table if another live order owns it.

## Healthy invariants verified in Production

- Raw warehouse inventory vs raw batches: 515/515 matched exactly.
- FIFO stock-adjustment pending delta: 0.
- No current duplicate open shifts per branch.
- No expense/shift branch mismatch.
- No order/sale warehouse/branch mismatch.
- No live kitchen inventory over-deduction signal.
- Split-tender detail rows reconcile to sale headers.
- No negative or over-refunded sale-item refund rows.
- Kitchen inventory event costs reconcile to effect rows.

## Findings not treated as corruption

- Sales without `sale_payments` detail rows are valid legacy/simple-payment fallback.
- Cleopatra business date 2026-09-23 is the result of explicit rollover that closed day 22 while preserving the shift.
- Historical kitchen event totals may differ from current send snapshots after void/resend cycles.
- Negative raw batches are permitted raw-debt state under the current sell-through contract.

## Verification history

The superseded v1 branch passed Full Verify run `35696371462` end-to-end:
- lint/typecheck/unit/build ✅
- Fresh DB canonical migrations + schema ✅
- integration/security/RLS ✅
- Browser Smoke ✅

After PR #305 moved main, this v2 branch was recreated from the latest main. Exact-head Full Verify is required again before merge.

## Gate status

- Production writes: none.
- Production migration: not applied.
- Printing/KDS/Print Agent changes: none.
- Merge/apply require latest-main recheck, exact-head Full Verify Green, and explicit approval.
