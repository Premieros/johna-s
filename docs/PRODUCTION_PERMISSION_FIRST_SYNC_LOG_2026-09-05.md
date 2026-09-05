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

Exact Production function drift detected:

- `create_organization_branch(uuid,text,text,text,text)`
- `delete_branch_cascade(uuid)`
- `get_user_branch_access(uuid)`
- `open_shift(uuid,numeric,text)`
- `user_may_access_branch(uuid)`

The Production copies still contained fixed-role or organization-membership authorization (`owner`, `admin`, `cashier`) that is absent from the clean Fresh DB state.

## Function reconciliation

Added preflight migration:

- `20260905110590_production_permission_first_drift_reconcile.sql`

It deliberately sorts after `10575` and before the existing fail-closed `10600` migration. It does not weaken the `10600` audit.

Authorization rules in the repair:

- `user_may_access_branch`: Super Admin bypass + explicit `user_branch_access` + active primary branch only.
- `get_user_branch_access`: explicit/primary grants only; cross-user inspection requires explicit user-management capability.
- branch creation/deletion: `branches.manage` plus branch/org scope; Super Admin remains the only implicit bypass.
- successful branch creation records explicit `user_branch_access` for the authorized creator; no owner/admin role inheritance is restored.
- shift opening: `shifts.open` plus canonical branch access; no `cashier` role-name gate.
- only one open shift is allowed per user globally; successful `open_shift` returns both `shift_id` and `branch_id`.
- repaired SECURITY DEFINER functions use `search_path = public, pg_temp` and explicit EXECUTE grants.

Regression coverage added:

- `tests/integration/production_permission_first_drift.test.ts`

## Verify #737 — first preflight run

Run `33987695872` / Verify #737 passed frontend + Fresh DB/schema, then Integration/Security/RLS failed with seven assertions and Browser Smoke was skipped. Exact root causes were:

1. branch creation denial contract changed from `FORBIDDEN`.
2. authorized branch creation did not create an explicit branch-access grant for the creator.
3. `open_shift` omitted `branch_id` and allowed simultaneous open shifts per branch instead of one per user.

No tests/RLS were weakened. The preflight was corrected accordingly.

## Verify #739 / PR #22

Run `33988027648` / Verify #739 passed all required gates:

- frontend verify ✅
- Fresh DB migrations/schema ✅
- Integration/Security/RLS ✅
- Browser Smoke ✅

PR #22 was merged as `main@0cde328020f6ea4532179cf41f959e97723ccc14`.

The verified `10590` preflight was then applied successfully to Production.

## Production RLS drift found by 10600

Retrying the existing `20260905110600_permission_first_runtime_reconcile.sql` again failed closed, now only on six Production RLS policies:

- `products:auth_insert_products`
- `products:auth_update_products`
- `products:auth_delete_products`
- `inventory:auth_insert_inventory`
- `inventory:auth_update_inventory`
- `inventory:auth_delete_inventory`

Read-only inspection confirmed the Production policies still referenced retired coarse permissions:

- `products.manage`
- `inventory.manage`

Added a second preflight migration:

- `20260905110595_production_rls_permission_first_drift_reconcile.sql`

It keeps RLS enabled and maps the six policies to canonical granular capabilities:

- product INSERT → `products.create`
- product UPDATE → `products.edit`
- product DELETE → `products.delete`
- inventory INSERT/UPDATE/DELETE → `inventory.adjust`
- all non-Super-Admin operations remain scoped by `user_may_access_branch(branch_id)`.

This second preflight must pass Fresh DB + Integration/Security/RLS + Browser Smoke before Production application. The original `10600` fail-closed audit remains unchanged and must pass afterward.

## Safety rule

No Production audit was bypassed and no RLS/test was weakened. All Production changes are applied only to `azzdesuowpdcoflmyezn`, and every drift repair is promoted through CI before Production.
