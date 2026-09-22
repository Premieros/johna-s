# Critical Stability Monitor

## Purpose

This monitor is the read-only health check used by the stabilization track before and after repairs.

File:
- `scripts/audit/critical-integrity.sql`

The query returns one JSON object and performs no database mutation.

## Covered invariants

- at most one open shift per branch;
- stale empty open-order shells;
- table occupancy vs effective open orders;
- branch/warehouse consistency for purchases, sales, orders and raw inventory;
- raw inventory cache vs FIFO/raw batches;
- outstanding FIFO reconciliation delta;
- balanced journal entries;
- detailed tender rows vs sale header paid/refunded amounts;
- refund quantity/value bounds;
- live kitchen send snapshot vs unsettled inventory events;
- cloud print jobs stuck in an active state for more than 10 minutes.

## Baseline — 2026-09-22

Production project inspected read-only: `azzdesuowpdcoflmyezn`.

Current result:
- duplicate open shift branches: 0
- vacant table with effective open order: 0
- occupied table without effective open order: 0
- sale/order/raw-inventory warehouse branch mismatches: 0
- raw batch quantity mismatches: 0
- FIFO unreconciled rows / pending delta: 0 / 0
- unbalanced journal entries: 0
- tender-detail mismatch: 0
- refund integrity violations: 0
- live kitchen inventory mismatch: 0
- stale active print jobs: 0
- purchase warehouse branch mismatch: 12
- stale empty open orders: 4

The final two non-zero values are the already-audited historical cases staged by PR #306. They remain visible until its Production migration is explicitly approved and applied.

## Isolation rule

This monitor does not own or modify printing, KDS, POS transfer/void, refunds, dashboard performance, or other active PR scopes. A non-zero check starts a separate latest-main repair branch only after overlap review.
