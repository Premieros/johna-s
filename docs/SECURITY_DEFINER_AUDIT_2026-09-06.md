# SECURITY DEFINER Audit — 2026-09-06

## Identity lock

- Repository: `Premieros/johna-s`
- Baseline: `main@b71abb6d8a13e742aec271c488bcf877aacdfa9e`
- Production Supabase: `azzdesuowpdcoflmyezn` only
- Authorization contract: Super Admin is the only implicit bypass; every other role is a label and operational authorization must be permission-first and branch-scoped.

## Security Advisor baseline

The Production Security Advisor currently reports:

1. Two anonymous-executable `SECURITY DEFINER` functions in the exposed `public` schema:
   - `get_login_email(text)`
   - `record_login_failure(text)`
2. A larger set of authenticated-executable `SECURITY DEFINER` RPCs.
3. Supabase Auth Leaked Password Protection disabled.

The authenticated warning class is not treated as an automatic vulnerability. Several listed RPCs are intentional application endpoints and already enforce `auth.uid()`, canonical permissions, branch access, manager approval, or explicit Super Admin checks.

## Anonymous login boundary — confirmed fix

The two anonymous functions are required before a user session exists, so simply revoking `anon` would break username login.

PR #24 (`fix/security-definer-anon-wrappers-20260906`) therefore keeps the public RPC contract but removes privileged execution from the exposed functions:

- `public.get_login_email(text)` -> `SECURITY INVOKER` wrapper
- `public.record_login_failure(text)` -> `SECURITY INVOKER` wrapper
- privileged implementations move to non-exposed schema `app_private`
- internal implementations remain `SECURITY DEFINER` with `search_path = public, pg_temp`
- `PUBLIC` receives no schema/function privilege
- only `anon`, `authenticated`, and `service_role` receive the minimum required usage/execute grants

Migration:

- `20260905223000_login_rpc_security_boundary.sql`

Regression coverage:

- `tests/integration/login_rpc_security_boundary.test.ts`

Verify #745 / run `33992644940`:

- frontend verify: PASS ✅
- Fresh DB / Integration / RLS: running at the time of this log entry
- no Production DDL has been applied from PR #24 yet

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
   - must be classified as internal helper versus public RPC by tracing every caller before revoking or changing execution semantics.

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

## Safety decisions

- No blanket `REVOKE EXECUTE` on authenticated application RPCs.
- No blanket conversion to `SECURITY INVOKER`.
- No RLS or test weakening.
- No Production changes from an unverified branch.
- Every confirmed gap is handled in a narrow migration with regression tests and Fresh DB + Integration/Security/RLS + Browser Smoke before Production.

## Remaining P0

1. Finish PR #24 Verify and merge/apply only when all gates are green.
2. Re-run Security Advisor and confirm the two exposed anonymous `SECURITY DEFINER` warnings are removed without breaking pre-auth login.
3. Open a separate narrow hardening batch for confirmed authenticated gaps above.
4. Resolve Supabase Auth Leaked Password Protection as P0-C; do not mark complete until the platform setting is actually enabled and verified.
