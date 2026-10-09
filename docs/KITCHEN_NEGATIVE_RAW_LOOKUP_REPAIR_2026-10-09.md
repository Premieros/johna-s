# Kitchen negative raw-stock performance repair — active work log

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/kitchen-raw-negative-batch-lookup-20261009`
Current PR: #485
Last updated: 2026-10-09

## Work status
State: **BLOCKED** until exact-head Full Verify Green, index performance checks, physical printing smoke and explicit production approval.

## Guardrails
- No edits to printing, Print Agent, KDS, existing inventory FIFO functions, debt, accounting, finance, or business authorizations.
- No SQL applied to production; schema changes require independent approval.
- Never use higher statement_timeout alone as a workaround.

## Baseline
main@3e2420543700258c9754a1af7234d4043ff30f0f; last full green PR #484 Verify #3982.

## Root-cause ledger
- SQLSTATE 57014 kitchen failure in raw_material_batches SUM(quantity) by raw_material_id/branch_id/warehouse_id.
- Production has a three-key partial index only for quantity>0, but negative raw stock requires all quantities.
- Other kitchen failures occurred on kitchen inventory events UPDATE and price snapshot / financial visibility lookups; this index alone is not a complete cure.

## Change ledger
- Add narrow full-balance index with INCLUDE(quantity), no mutations of inventory rows or functions.
- Add static contract unit test preventing a partial positive-only index.

## Verification ledger
- Production definitions and log contexts inspected read-only.
- Need fresh CI and representative DB EXPLAIN against sanitized test data; no demonstrated latency reduction yet.
- Full functional scenarios required: negative FIFO debt, positive stock, retries, concurrent kitchen send and kitchen/receipt printing.
- Future independent work remains for pricing/costing, printing read errors, refund and auth.

## Production gate
- State: **BLOCKED**. No production DDL, merge, deployment or user-data rewrite.
- CREATE INDEX can cause a lock on writers when applied through a transactional migration; schedule maintenance/verify locks before rollout.

## Next action
- Run exact-head CI; review long-running query plans and performance; pursue separate safe fixes for remaining timeout locations.

## Mandatory update protocol
- Reconcile branch against latest main, active plan, CI and current writer before any merge or live DDL.
