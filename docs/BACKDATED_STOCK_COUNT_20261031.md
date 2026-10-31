# Backdated stock count — implementation gate (31 October 2026)

## Requested behavior
Physically counted on 2026-10-31, entered on 2026-11-01. Correct variance must be measured at the actual physical cutoff; transactions after that cutoff must remain in current stock.

## Verified production behavior
- `stock_counts` currently records created/submitted/approved/applied timestamps, not a count cutoff.
- `create_stock_count` captures the system quantity **at creation**, not physical cutoff.
- `apply_stock_count` computes `counted_quantity - live quantity`, then makes FIFO adjustments and inventory/variance journals. This is unsafe for a count entered after later movements.
- Existing approved counts must NOT be silently reinterpreted.

## Scope of first foundation commit
Add an optional `counted_at` timestamp, without changing existing records, live writes, API behavior, FIFO functions or accounting. This is NOT functional support for backdated posting.

## Required before enabling
1. Define cutoff timezone and whether physical count is taken with operations paused; store exact timestamp, never only date.
2. Verify immutable, complete per-warehouse and per-item movement history for receipts, kitchen consumption, production, transfers, voids, returns and adjustments, with actual ordering and no missing historical backfill. If absent, fail closed.
3. Reconstruct quantity **as of cutoff** and freeze baseline + actual quantities + variance with auditable source and reconciliation version; reject duplicate counts or conflicting adjustments.
4. Apply the **historical variance delta** to current stock atomically, not `counted_quantity - current_quantity`. Serialize with sales/receipts and FIFO debt settlement using existing advisory locks.
5. For negative stock, make FIFO layers, debt matching, COGS and journal postings consistent; do not reprice closed sales or overwrite historical accounting.
6. Add role checks, branch/warehouse access, approval, signed audit, closed-period policies, and explicit compensating reversal. No arbitrary timestamp edits to ledger `created_at`.
7. Verify historical quantity roll-forward equation and valuation in disposable DB tests: same-day and delayed count, sale/receipt/transfer/void after cutoff, negative FIFO, concurrent kitchen send, repeated apply, closed period, multi-warehouse.

## Immediate customer procedure
Preserve the 2026-10-31 count sheet and exact cutoff per warehouse. It may be entered as a draft, but **DO NOT APPLY** via the current workflow until backdated reconciliation passes acceptance. No changes to production are authorized by this development branch.

## Release controls
No automatic merge or production deployment. Separate acceptance and rollback required.
