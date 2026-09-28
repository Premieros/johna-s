# Costing Theoretical Hotfix — 2026-09-28

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `hotfix/costing-theoretical-source-20260928`
Current PR: `#404`
Last updated: 2026-09-28 23:03 Africa/Cairo

## Work status
State: **BLOCKED**

Blocked only on exact-head verification. The code change is complete and intentionally bounded.

## Guardrails
- No direct write to `main`.
- No force push.
- No weakening RLS, permissions, security-definer ACLs, or tests.
- No change to POS, send-to-kitchen, inventory deduction, printing, Print Agent, KDS, payments, shifts, or historical COGS.
- No production data rewrite.
- Production migration only after exact-head verification is Green.

## Baseline
- Production/main baseline: `a1b8e77d5e1b0466d78f4d72170a9a1c9f22ebbf`.
- Root cause confirmed on Production: current active-product `_product_bom_cost` total is 0.00 while canonical recipe cost total is 24501.10.
- The active costing overview still exposed the retired `product_components` path as `theoretical_cost`.

## Root-cause ledger
1. `get_costing_overview` calculated `theoretical_cost` from a bulk `product_components` BOM CTE.
2. `get_product_costing_detail` calculated `theoretical_cost` through `_product_bom_cost`.
3. Active products no longer carry meaningful costs in the retired BOM path, so the theoretical figure could remain zero/stale after recipe and linked-group costing changed.
4. The canonical current recipe model already includes direct raw materials and linked manufactured component groups.

## Change ledger
- Added migration `20260928233000_costing_theoretical_recipe_source.sql`.
- `_product_bom_cost` is retained only as a compatibility helper and now delegates to canonical `_product_recipe_cost`.
- `get_costing_overview` now emits canonical recipe cost as `theoretical_cost`; linked manufactured groups are therefore included.
- Removed the dead BOM-cost aggregation from the overview query while keeping the component count contract.
- Added regression assertions in `tests/integration/product_costing.test.ts` so linked group cost changes both `actual_cost` and `theoretical_cost` in the current model.
- Corrected a test-only escaped newline that caused the first Full Verify attempt to stop at ESLint parsing; no production logic changed.

## Verification ledger
- Production read-only root-cause query: old theoretical aggregate 0.00; linked-group aggregate 1442.10; canonical recipe aggregate 24501.10; 95 active products use linked groups.
- PR #404 created from exact main baseline.
- First Full Verify attempt stopped at test-file lint parsing only; corrected. Exact-head rerun pending.
- Production parity: pending.
- Production migration: not applied yet.

## Production gate
Do not apply the migration until the final exact hotfix HEAD passes repository verification. After that, recheck `main` has not moved unexpectedly, apply the single migration, verify ACLs/results, merge PR #404, and verify deployment.

## Next action
Run exact-head verification after the worklog update, then apply the single production migration if Green.

## Mandatory update protocol
Update this log after every material write, verification result, migration, merge, or unexpected HEAD change. Keep the State BLOCKED until the production gate is satisfied.
