# Johna's raw cost engine v2 — owner-approved architecture, low-storage cutover
Date: 2026-10-31 | Branch: `architecture/raw-cost-engine-approved-price-no-replay-20261031`
Status: **DESIGN / GUARDED CANDIDATE; NOT ACTIVE**
Owner authorization: proceed with implementation, merge and deploy **when validated**. Never skip inventory/accounting integrity gates.
Related historical attempts: #558 (new negative issue only), #559 (11% synthetic performance improvement), production incident #557.

## Executive decision
Replace **accounting FIFO replay** with **approved-last-known cost frozen at source**, while retaining FEFO/FIFO for **physical lot depletion and expiry control**. Never recalculate 473 historical sales in a warehouse transfer transaction. Store each movement's original approved price, source and timestamp in the existing `inventory_ledger`. Do not create an `OV-*` batch and `raw_fifo_debts` row for every new oversold issue.

This is NOT moving-average costing and NOT abandoning traceability. Incoming purchases must continue to retain their actual approved receipt cost; issue costs use the authoritative latest approved source *as of the issue's event time*, branch-specific.

## Physical and financial state
1. **One source of approved unit price**: `private.latest_approved_raw_prices(branch_id,raw_ids,as_of)`. Require positive approved price and authorized branch/warehouse. If absent: block posting with clear `APPROVED_RAW_PRICE_UNAVAILABLE` for the v2 path; never invent zero/default or rewrite an invoice.
2. **Source issue**: acquire canonical per-material/branch advisory transaction lock, consume positive batches by expiration FIFO/FEFO, and create normal, auditable movement ledger rows at approved unit cost **regardless of historic physical batch cost**. Each movement snapshots the price's source/date/reference on the ledger itself. The business kitchen/sale/production records capture this frozen source value. The physical lots still record which lots moved.
3. **New negative stock**: represent the shortage as **one warehouse/material aggregate negative batch**, not a fresh debt record per issue. Keep the approved shortage's remaining quantity and frozen-cost basis in that existing batch. The per-issue movement ledger is already the immutable audit record; physical balance is still the canonical `raw_material_warehouse_inventory` SUM of batches. Never create a second debt or cost snapshot table for these new issues.
4. **Incoming stock**: record one receipt ledger at approved actual receipt price. Cover the aggregate shortage first; deduct the absorbed quantity from incoming positive batch quantity, update shortage quantity and proportional frozen-cost basis, leave any remainder as normal positive receipt lot. The warehouse sum moves by the full receipt quantity. No replay of past kitchen sales; no per-debt accounting cascade.
5. **Cost difference**: actual receipt unit price minus frozen shortage cost basis generates **one** balanced receipt-period stock price-variance journal, netted per receipt, with explicit branch `stock_variance` and `inventory_rm` mappings and deterministic receipt-reference uniqueness. For receipts matching frozen cost, no extra journal. Missing accounts => atomic failure, not an unbalanced fallback. Reversal of receipt/transfer must reverse *the same* journal exactly once.
6. **Cutover**: legacy open debts are **not** simply deleted or zeroed. Before enabling v2 for any branch/raw material/warehouse, an auditable legacy preflight must resolve or convert them in isolated, bounded, idempotent batches, account for historic estimated-price liabilities and closed periods, retain original source ledgers, and verify no negative legacy batches remain. Until proven complete, keep that coordinate on legacy engine. In particular, Smouha espresso with 717 open debts cannot be silently skipped.
7. **Idempotency, concurrency and reporting**: approval RPC keeps transfer row lock and unique transfer ID; no automatic request retry. Existing branch/warehouse permissions and RLS are mandatory. Financial reports must expose any remaining legacy reconciliation obligations and journal differences; do not falsely mark documents settled.

## Invariants and acceptance
- Atomic transfer stock: source `-q`, receiver `+q`; no duplicate on replay.
- Accounting: every posted journal balanced, dates/closed periods correct, one variance journal per receipt.
- Frozen unit price provenance: same approved source at original event time for all new movement writers; kitchen/sale cost does not change when later receipt changes price.
- Snapshot-based reversals: refunds, cancelled kitchen sends, returns, transferred stock and post-cutover corrections reverse the *original* snapshot; do not use today's price retroactively.
- Physical batch quantity plus single aggregate shortage reconciles exactly to the warehouse view and `raw_material_inventory`. No phantom available stock because a negative lot was ignored.
- Preexisting inventory and accounting entries never directly mutated by this candidate.
- Missing authoritative price or legacy cutover: explicit error/legacy path, no silent zero.
- Not a new per-transaction queue, not a new business table per debt, not a background promise without durable scheduler and progress.

## Concrete schema candidate (no activation)
`scripts/db/candidates/approved_raw_cost_engine_minimal_storage_20261031.sql`:
- Five nullable price metadata columns in `inventory_ledger` (NULL for all old rows, no backfill).
- One numeric shortage-cost accumulator column in existing `raw_material_batches`.
- One partial unique index enforcing at most **one** v2 aggregate shortage row per branch/warehouse/material.
- Named NOT VALID future-only safety checks. No new table, RPC, trigger, permission, migration, or business-data update.
- Intentionally stored under `scripts/db/candidates/`, not `supabase/migrations/`. The SQL must remain unused until writer/reader/rollback release gates are met.

## Unwired first implementation (2026-10-31)
- `scripts/db/candidates/approved_raw_cost_engine_v2_helpers_20261031.sql`: two internal, SECURITY INVOKER / private-schema helpers for approved cost issue + receipt on a warehouse that has **zero open legacy debts**. Both maintain raw stock, freeze approved price in the original movement ledger, and use one negative shortage aggregate per material/warehouse. Receipts only journal the variance (existing account mappings) rather than rewriting historical kitchen/sale references. Explicit branch/warehouse preflights and canonical advisory transaction lock.
- `tests/integration/approvedRawCostV2TinyPrototype.test.ts`: at most 3 issues and 2 receipts; runs inside rolled-back disposable CI PostgreSQL with source-price checks, shortage aggregation, frozen-price ledger snapshots, receipts and balanced journal. **No new 717-debt fixture.**
- **Strict limit:** helpers are unprivileged and **not called by any existing business RPC or web app**; no production migration exists. The same old-debt restriction prevents falsely claiming the Smouha #00008 transfer has been fixed. Full historical consolidation and compatibility release gates still mandatory.

## Implementation order
A. **Engine in isolated SQL**: implement new `private` helpers consuming / receiving without legacy side effects, plus source snapshots and idempotent variance journal; keep old entry points unchanged. Ensure no unexpected public SECURITY DEFINER grants.
B. **Small correctness suite only**: one 2–5-row disposable-Postgres test covering positive, negative, partial receive, price mismatch, missing price, same/cross branch, reversing source snapshots, concurrent source lock and journal balance. Reuse existing tests; **do not generate repetitive 717-debt performance fixtures**. CI DB container is ephemeral GitHub Actions Postgres 16; never use production Supabase for test writes.
C. **Legacy audit/rollover design**: production *READ-ONLY* aggregate counts, no personal/sale record export; calculate verified conversion balance and accounting by warehouse/material, handle estimated 94 vs unestimated 623. Convert only with explicit reconciled ledger and cutover marker ensuring idempotency; no deletion. Exercise with anonymized small fixture before any live write.
D. **Writers**: switch kitchen, sale, recipe, production, branch and same-branch transfers, purchases, inventory counts, refunds/reversals only after full parity. The flag/feature gate must be atomic and branch scoped and default OFF.
E. **Release**: exact head CI green; run stock/cost reconciliation read-only preflight, staged activation, balanced journals and fallback verification. Actual customer stock not used as a testing fixture. Merge does not imply authorization to bypass these accounting safeguards.

## Resource/cost control
- No recurring full-size synthetic 717-debt tests; previous #4564 (953 ms legacy vs 852 ms optimized) showed only ~11% gain, proving the optimizer doesn't solve expensive real production work.
- No fake rows in production for testing; GitHub CI uses isolated ephemeral PostgreSQL (no Supabase production storage growth).
- Limit future DB testing to tiny deterministic fixtures and read-only production metadata.
- Preserve existing regulated/auditable financial history; don't `DELETE` legacy records to save disk. Retention policy, if required, must have explicit business/legal approvals.

## Guard and release status
**BLOCKED / internal v2 prototype exists, but complete production writer + legacy conversion not implemented.**
No main merge, no production migration or approval of Johna's-00008 should be represented as complete until the transactional v2 functions, legacy conversion, writers, reversals, cost reports and CI are proven.

## Verification ledger
- Read-only actual database: `inventory_ledger` ~27 MB, `raw_fifo_debts` ~10 MB, kitchen events ~17 MB, kitchen effects ~16 MB (including indexes); these are **real operational tables**, not CI tests.
- Real Smouha espresso: 717 open FIFO debts, of which 94 carry provisional estimated price 1200 and 623 have no estimate.
- Previous PR #559 exact-head CI #4564 all green, 717 synthetic/473 sales parity and 953→852 ms (~11%) only; insufficient production guarantee.
- No schema writes to production; pending transfer #00008 was last confirmed pending with no posted ledger rows.
- Five-movement disposable prototype's CI run/result to be recorded after PR creation; this document intentionally does not claim success before verification.
