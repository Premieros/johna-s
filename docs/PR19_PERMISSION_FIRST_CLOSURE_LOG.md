# PR #19 Permission-First Closure Log

> Mandatory execution log for `fix/permission-first-root-closure-clean`.
> Repository: `Premieros/johna-s`.
> Locked Supabase project ref: `azzdesuowpdcoflmyezn` only (`john's`, eu-west-1).

## 2026-09-05 — Clean merge-candidate closure

### Identity / source of truth
- Repository verified: `Premieros/johna-s`.
- Base branch: `main`.
- Verified main base for this clean branch: `a31dc4293fc4b5b24b5a272de2c6d1466b7a0de5`.
- Supabase verified again before work: `azzdesuowpdcoflmyezn`, name `john's`, status `ACTIVE_HEALTHY`.
- Source of Truth: `docs/CURRENT_WORK_PLAN.md`.
- No Production DDL was applied in this pass.

### Why PR #19 exists
PR #18 had become heavily diverged from current `main` (47 commits ahead and 8 commits behind) and was not a safe merge candidate. A clean branch was created directly from current `main`, then only the final Permission-First functional changes and regression tests were carried over.

Clean functional base commit:
- `db946df59eea2b69e60570e4822915fad82b22ec`

### Verify #706
Run: `33981236488` / `#706`
- Database Identity Lock ✅
- API Contract ✅
- Lint ✅
- TypeScript app/tests ✅
- Unit ✅
- Build ✅
- Fresh DB + canonical migrations ✅
- Schema verification ✅
- Integration/Security/RLS ❌
- Browser Smoke skipped because DB gate failed.

### Verify #707 — exact regression extraction
Run: `33981417070` / `#707`
- Frontend/Build gates ✅
- Fresh DB / Schema ✅
- Integration: 456 passed / 463 total; 7 failed.
- Diagnostic artifact: `verify-integration-log`, artifact id `9973889701`.

Exact failing areas:
1. `auto_production_sale_availability.test.ts` — sale returned `success:false`.
2. `purchase_uom_auto_sale_cycle.test.ts` — sale returned `success:false`.
3. `ready_product_sale_deduction.test.ts` — sale returned `success:false`.
4. `unit_production_sale_flow.test.ts` — sale returned `success:false`.
5. `rls_branch_isolation.test.ts` — role insert failed with `PERMISSION_DENIED:roles.permissions.manage`.
6. `kitchen_station_editor_context.test.ts` — branch manager context returned `success:false`.
7. `v2_operational_approval_security.test.ts` — authorized secondary-branch stock-count approval returned `TRANSACTION_FAILED`.

### Root causes
1. The historical `_process_sale_core` cashier-name shift gate was rewritten to `pos.payment.take`. Once `owner` correctly stopped being an implicit admin, owner fixtures holding payment permission were treated like register operators and required an open shift. The capability model needs a manager override via explicit `shifts.manage`, not an owner bypass.
2. `guard_role_permissions` required the new canonical `roles.permissions.manage`, but regression fixtures still relied on the old branch-manager label. The guard also needed a fail-closed rule preventing users from granting permissions they do not themselves possess.
3. Stock-count approval still compared only `users.branch_id`; this conflicts with the project multi-branch contract where `user_branch_access` / `user_may_access_branch()` grants explicit secondary branch access.
4. Kitchen editor authorization correctly moved to `settings.manage`, so its CI principal must receive that capability explicitly instead of inheriting it from the `branch_manager` label.

### Fixes applied
- Added `supabase/migrations/20260905110625_permission_first_regression_closure.sql`:
  - shift enforcement remains permission-first: payment operators require a shift unless they explicitly hold `shifts.manage`; Super Admin remains the only implicit bypass.
  - `guard_role_permissions` now requires `roles.permissions.manage`, scopes non-admin role creation to an accessible branch, and prevents privilege escalation by rejecting permissions the caller does not own.
  - `approve_stock_count()` now requires `inventory.count.approve` and validates branch scope using `user_may_access_branch()`.
- Added CI-only `supabase/ci/permission_first_role_fixture.sql`:
  - explicitly grants the branch-manager test principal `settings.manage` and `roles.permissions.manage`.
  - this fixture is never applied to Production.
- Updated `verify-main.yml` to apply the CI-only permission fixture and preserve the integration failure artifact while closing the regression.

Relevant commits in this batch:
- `5d57c1165465f1d4da7997af86cb7cacbfaa2020`
- `00ef803edbb3fc4cdc9b62c8ab4fdf3290604f7c`
- `ac25a0aa64f28748ed8317b1c0126931e61e9833`

### Authorization invariants
- Super Admin only = implicit bypass.
- `owner` and every other role = labels only.
- Effective authorization = canonical `roles.permissions` + branch/RLS scope.
- No Legacy permission alias is reintroduced.
- No RLS/test weakening is allowed to make CI green.

### Current status
`IN_PROGRESS — ROOT CAUSES PATCHED; CURRENT-HEAD FULL VERIFY REQUIRED`.
