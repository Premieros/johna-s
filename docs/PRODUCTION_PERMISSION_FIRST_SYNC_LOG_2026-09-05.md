# Production Permission-First Sync Log — 2026-09-05

## Identity lock

- Repository: `Premieros/johna-s`
- Source baseline: `main@79d34660ea4770b2461bef69286a664d9c647805`
- Production Supabase: `azzdesuowpdcoflmyezn`
- No other repository or database is authorized for this batch.

## Verified source baseline

`main@79d34660ea4770b2461bef69286a664d9c647805` passed Verify #736 and Deploy #526 before Production synchronization started.

## Production migration gap

Production migration history ended at source migration `20260905103458_restore_permission_first_user_branch_access` before this batch. The verified source contained seven later migrations.

Applied successfully before drift was exposed:

1. `20260905110500_permission_first_root_drift_cleanup.sql`
2. `20260905110550_permission_first_endpoint_normalization.sql`
3. `20260905110575_permission_first_purchase_kitchen_normalization.sql`

The next migration, `20260905110600_permission_first_runtime_reconcile.sql`, correctly failed closed on Production instead of bypassing its audit.

Exact Production drift detected:

- `create_organization_branch(uuid,text,text,text,text)`
- `delete_branch_cascade(uuid)`
- `get_user_branch_access(uuid)`
- `open_shift(uuid,numeric,text)`
- `user_may_access_branch(uuid)`

The Production copies still contained fixed-role or organization-membership authorization (`owner`, `admin`, `cashier`) that is absent from the clean Fresh DB state.

## Reconciliation

Added preflight migration:

- `20260905110590_production_permission_first_drift_reconcile.sql`

It deliberately sorts after `10575` and before the existing fail-closed `10600` migration. It does not weaken the `10600` audit.

Authorization rules in the repair:

- `user_may_access_branch`: Super Admin bypass + explicit `user_branch_access` + active primary branch only.
- `get_user_branch_access`: explicit/primary grants only; cross-user inspection requires explicit user-management capability.
- branch creation/deletion: `branches.manage` plus branch/org scope; Super Admin remains the only implicit bypass.
- shift opening: `shifts.open` plus canonical branch access; no `cashier` role-name gate.
- repaired SECURITY DEFINER functions use `search_path = public, pg_temp` and explicit EXECUTE grants.

Regression coverage added:

- `tests/integration/production_permission_first_drift.test.ts`

The test fails if any of the five endpoints regresses to fixed operational role authorization or loses its canonical capability checks.

## Safety rule

No Production audit was bypassed and no RLS/test was weakened. The preflight migration must pass Fresh DB + Integration/Security/RLS + Browser Smoke before it is applied to Production. After that, the original `10600`, `10610`, `10625`, and P0-B security hardening migrations are retried/applied in source order.
