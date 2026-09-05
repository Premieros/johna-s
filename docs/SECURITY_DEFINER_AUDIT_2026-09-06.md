# SECURITY DEFINER Audit — 2026-09-06

## Identity lock

- Repository: `Premieros/johna-s`
- Baseline: `main@b71abb6d8a13e742aec271c488bcf877aacdfa9e`
- Production Supabase: `azzdesuowpdcoflmyezn` only
- Authorization contract: Super Admin is the only implicit bypass; every other role is a label and operational authorization must be permission-first and branch-scoped.

## Security Advisor baseline

The Production Security Advisor initially reported:

1. Two anonymous-executable `SECURITY DEFINER` functions in the exposed `public` schema:
   - `get_login_email(text)`
   - `record_login_failure(text)`
2. A larger set of authenticated-executable `SECURITY DEFINER` RPCs.
3. Supabase Auth Leaked Password Protection disabled.

The authenticated warning class is not treated as an automatic vulnerability. Several listed RPCs are intentional application endpoints and already enforce `auth.uid()`, canonical permissions, branch access, manager approval, or explicit Super Admin checks.

## Anonymous login boundary — closed

The two anonymous functions are required before a user session exists, so simply revoking `anon` would break username login.

PR #24 (`fix/security-definer-anon-wrappers-20260906`) keeps the public RPC contract but removes privileged execution from the exposed functions:

- `public.get_login_email(text)` -> `SECURITY INVOKER` wrapper
- `public.record_login_failure(text)` -> `SECURITY INVOKER` wrapper
- privileged implementations moved to non-exposed schema `app_private`
- internal implementations remain `SECURITY DEFINER` with `search_path = public, pg_temp`
- `PUBLIC` receives no schema/function privilege
- only `anon`, `authenticated`, and `service_role` receive the minimum required usage/execute grants

Migration:

- `20260905223000_login_rpc_security_boundary.sql`

Regression coverage:

- `tests/integration/login_rpc_security_boundary.test.ts`

### Verification and merge

Verify #746 / run `33992781112` passed all required gates on the final PR head `8d45831db74fa297d96e7baf64f4953e791133d6`:

- frontend verify ✅
- Database Identity Lock ✅
- API contract ✅
- lint ✅
- TypeScript app/tests ✅
- unit ✅
- build ✅
- Fresh DB canonical migrations/schema ✅
- Integration/Security/RLS ✅
- Browser Smoke ✅

PR #24 was merged into `main` as:

- `main@7193275c8bba97ff5dde35f3c083fe1e609cdaf0`

### Production application

The exact repository migration from merged `main` was applied to Production project `azzdesuowpdcoflmyezn` using the tracked migration path only. No ad-hoc DDL was used.

Post-application catalog verification confirms:

- `public.get_login_email(text)` -> `SECURITY INVOKER`, `anon` EXECUTE yes, `PUBLIC` EXECUTE no, search path includes `app_private, public, pg_temp` ✅
- `public.record_login_failure(text)` -> `SECURITY INVOKER`, `anon` EXECUTE yes, `PUBLIC` EXECUTE no, search path includes `app_private, public, pg_temp` ✅
- `app_private.get_login_email(text)` -> `SECURITY DEFINER`, `PUBLIC` EXECUTE no, `search_path = public, pg_temp` ✅
- `app_private.record_login_failure(text)` -> `SECURITY DEFINER`, `PUBLIC` EXECUTE no, `search_path = public, pg_temp` ✅

A fresh Security Advisor run after Production application no longer reports any `anon_security_definer_function_executable` finding for the two login RPCs. The anonymous SECURITY DEFINER exposure tracked by this batch is therefore closed.

## Authenticated SECURITY DEFINER classification

### Intended privileged/admin API — internally guarded

Read-only inspection confirms explicit admin predicates in examples including:

- `get_super_admin_all_users`
- `get_super_admin_tenant_stats`
- `password_matches`
- `repair_auth_account`
- `verify_auth_account`
- `login_as_user`
- subscription/settings Super Admin mutation RPCs
- administrative data seed/delete RPCs

These should not be bulk-revoked solely to silence the Advisor. They require contract-aware review of predicate, branch/tenant scope, grants, owner and `search_path`.

### Operational API — guarded directly or through a terminal handler

Examples already using canonical controls include:

- `can_permission(text)` -> DB role permissions, Super Admin only implicit bypass
- `cancel_sent_order_item_exact(...)` -> authentication, active user, branch access, approval rules
- `get_feature_access(...)` -> branch access before delegated feature resolution
- `get_low_stock_alerts(...)` -> non-admin branch scope
- `get_stock_valuation(...)` -> non-admin branch scope

Delegating wrappers must still be checked for information-oracle behavior before the terminal authorization check.

## Confirmed follow-up candidates

The audit found several functions that need separate narrow hardening rather than blanket changes:

1. `get_cost_history(product_id, limit)`
   - `SECURITY DEFINER`
   - reads product cost history and user display identity
   - no direct authentication/permission/branch check
   - candidate cross-branch information exposure.

2. `get_production_variance(unit_id, branch_id)`
   - accepts branch input under `SECURITY DEFINER`
   - no direct auth/branch/permission check in the function body
   - requires caller/permission contract review before repair.

3. `update_branch(...)` / `deactivate_branch(...)`
   - currently authorize through `user_can_access_organization(...)`
   - that helper allows any active organization member, not specifically `branches.manage`
   - inconsistent with the Permission-First contract and requires a dedicated regression-tested correction.

4. `next_document_number(type)`
   - mutates shared sequence state under `SECURITY DEFINER` without a direct authorization check
   - read-only caller tracing found it is used internally by multiple order, purchasing, stock, treasury and accounting RPCs; it must be hardened as an internal helper without breaking those callers.

5. `cancel_sent_order_item(...)`
   - terminal exact handler is properly guarded
   - wrapper performs a pre-authorization lookup and may disclose sent-item existence/ambiguity across branches if IDs are known
   - candidate for wrapper-level auth/scope hardening.

6. `resolve_product_modifiers(...)`
   - enforces entity/branch consistency but not current-user branch access
   - needs POS caller tracing before changing semantics.

7. Stale role-based demo helpers in Production require drift comparison against repository migrations before any mutation:
   - `seed_demo_data`
   - `delete_demo_data`
   These still reference `is_branch_manager()` in the inspected Production definitions, which conflicts with the Permission-First contract if they are still live canonical functions.

## Permission/scope hardening preflight — PR #25

Branch: `fix/security-definer-permission-scope-20260906`

Migration:

- `20260905224500_security_definer_permission_scope.sql`

The narrow batch hardens four confirmed gaps without changing their public signatures:

- `update_branch(...)` -> requires `branches.manage` + `user_may_access_branch(p_branch_id)`.
- `deactivate_branch(uuid)` -> requires `branches.manage` + `user_may_access_branch(p_branch_id)`.
- `get_cost_history(uuid,integer)` -> requires `reports.costing` + product branch access.
- `get_production_variance(uuid,uuid)` -> requires `reports.costing` + requested branch access.
- all four deny `PUBLIC` execute and use `search_path = public, pg_temp`.

Regression coverage:

- `tests/integration/security_definer_permission_scope.test.ts`
- existing `tests/integration/phase2_production_variance.test.ts` strengthened to prove that a role label alone does not authorize costing data: the request is denied before `reports.costing` is explicitly granted inside the rollback-only fixture, then succeeds after the capability is granted.

### Verify #749 — first preflight result

Run `33993183583` passed frontend verification, Fresh DB and schema, then Integration/Security/RLS reported exactly one failure out of 474 tests:

- `tests/integration/phase2_production_variance.test.ts`
- `get_production_variance returns variance rows`
- expected at least one row, received zero.

Root cause: the historical fixture created an `owner` user and implicitly expected the role label to authorize the read. The new RPC correctly required `reports.costing`, so the fixture exposed a stale role-first assumption. The function authorization was not weakened. The test was corrected to explicitly grant `reports.costing` and also assert denial before the grant.

No Production DDL has been applied from PR #25. A new full Verify on the final documented head is required before merge or Production application.

## Safety decisions

- No blanket `REVOKE EXECUTE` on authenticated application RPCs.
- No blanket conversion to `SECURITY INVOKER`.
- No RLS or test weakening.
- No Production changes from an unverified branch.
- Every confirmed gap is handled in a narrow migration with regression tests and Fresh DB + Integration/Security/RLS + Browser Smoke before Production.

## Remaining P0

1. Anonymous SECURITY DEFINER login exposure: CLOSED ✅
2. Complete PR #25 permission/scope preflight and promote only if every gate is green.
3. Continue separate narrow hardening for remaining authenticated gaps: internal sequence helper, sent-item wrapper oracle, modifier resolver, stale demo helpers and costing-detail scope.
4. Re-run Advisor after each promoted hardening batch instead of chasing warning count by bulk mutation.
5. Resolve Supabase Auth Leaked Password Protection as P0-C; do not mark complete until the platform setting is actually enabled and verified.
