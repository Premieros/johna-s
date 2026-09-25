# EXPENSE ROUTING INDEX OPTIMIZATION — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/expense-routing-indexes-20260926`
Current PR: pending
Last updated: 2026-09-26

## Work status
State: **IN_PROGRESS**

## Guardrails
- Index-only optimization for `public.expense_routing_rules`.
- No data rewrite, no report logic change, no accounting behavior change.
- No printing / KDS / Print Agent changes.
- No direct write to `main`.
- Production apply only after exact-head Full Verify Green.

## Baseline
- Base: `main@8ea407b3de1313a4809e409312d9b003e7a3b11e`.
- PR #375 is merged and Production API parity is Green.
- Production table starts with no routing rows; expense history is unchanged.
- Supabase Performance Advisor reported missing covering indexes on four foreign keys of `expense_routing_rules`.

## Change ledger
- Pending: add covering indexes for `expense_account_id`, `treasury_account_id`, `created_by`, and `updated_by`.

## Verification ledger
- Baseline deploy #835: build ✅, Production API parity ✅, deploy ✅.
- Baseline main Verify #2873: verify ✅, db ✅; browser-smoke was still running when this follow-up started.
- Exact-head verification for this branch: pending.

## Production gate
- Production migration: **BLOCKED** until exact-head Full Verify Green.
- User explicitly approved this index-only follow-up on 2026-09-26.

## Next action
1. Add index-only forward migration.
2. Run exact-head Fast/Full Verify.
3. Merge if Green.
4. Apply only the index migration to Production.
5. Re-run Performance Advisor and verify the four findings are cleared.

## Mandatory update protocol
- Before every repository write, verify expected branch HEAD.
- Any unexpected HEAD requires STOP_AND_RECONCILE.
- Keep this scope index-only.
