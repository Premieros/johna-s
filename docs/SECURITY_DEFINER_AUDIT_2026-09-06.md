# SECURITY DEFINER Audit — 2026-09-06

## Identity lock

- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn` only
- Authorization contract: Super Admin is the only implicit bypass; every other role is a label and operational authorization must be permission-first and branch-scoped.
- Final handover development branch: `development/final-handover`.

## Closed work

### Anonymous login boundary

PR #24 moved the privileged login implementations out of the exposed API boundary while preserving the public RPC contract. Verify #746 passed frontend, Fresh DB/schema, Integration/Security/RLS and Browser Smoke. The merged migration was applied to Production, and the two anonymous SECURITY DEFINER Advisor findings disappeared. CLOSED ✅

### Permission/scope hardening batch #25

PR #25 hardened:

- `update_branch(...)` -> `branches.manage` + `user_may_access_branch`
- `deactivate_branch(...)` -> `branches.manage` + `user_may_access_branch`
- `get_cost_history(...)` -> `reports.costing` + product branch access
- `get_production_variance(...)` -> `reports.costing` + requested branch access

Verify #751 / run `33993476931` passed frontend, Fresh DB/schema, Integration/Security/RLS and Browser Smoke. PR #25 merged as `3aa2ae907bc64ffd73bf1ca024ac7afc9c38beb1`, and its exact migration was applied successfully to Production. CLOSED ✅

### next_document_number internal boundary — PR #26

PR #26 hardened `public.next_document_number(text)` as an internal sequence helper:

- migration `20260905230000_next_document_number_internal_only.sql`
- `search_path = public, pg_temp`
- `PUBLIC`, `anon`, and direct `authenticated` EXECUTE removed
- explicit `service_role` EXECUTE retained
- regression test `tests/integration/next_document_number_security.test.ts`

Verify #775 / run `33994683355` passed. PR #26 merged into `main` as `8a68e153d96e0e1e01f0bd0c07637ff470512c15`. The exact tracked migration was applied to Production `azzdesuowpdcoflmyezn` successfully. Post-application catalog verification confirms `anon_exec=false`, `authenticated_exec=false`, `service_exec=true`, and `search_path=public, pg_temp`. CLOSED ✅

## Final handover branch organization

- `main` is Production/Release only.
- The single active development line is `development/final-handover`.
- Historical fix/development branches are superseded and must not be reused.
- No force-update workaround is used for cleanup.

## cancel_sent_order_item wrapper boundary — IN VERIFICATION ⏳

Read-only Production inspection confirmed that `public.cancel_sent_order_item(uuid, uuid, numeric, text)` is `SECURITY DEFINER` and performs its sent-item lookup before authentication and branch authorization. Because it can return `SENT_ITEM_NOT_FOUND` or `AMBIGUOUS_SENT_ITEM` before delegating to the guarded exact handler, the wrapper can act as a sent-item information oracle for a caller that knows foreign identifiers.

Final-handover hardening prepared on `development/final-handover`:

- migration `20260906115500_cancel_sent_order_item_wrapper_scope.sql`
- require `auth.uid()` first
- require an active application user before order lookup
- resolve the order branch and require `user_may_access_branch(...)` before any `order_items` / `order_kitchen_sends` lookup
- preserve the existing public RPC signature and terminal `cancel_sent_order_item_exact(...)` behavior
- preserve authenticated/service-role API access and keep anon denied
- regression test `tests/integration/cancel_sent_order_item_wrapper_security.test.ts`

No Production DDL for this batch until frontend + Fresh DB/schema + Integration/Security/RLS + Browser Smoke gates are green.

## Authenticated SECURITY DEFINER classification

The remaining Advisor warnings are not treated as automatic vulnerabilities. Many are intentional application RPCs and already enforce one or more of:

- `auth.uid()`
- canonical permissions
- `user_may_access_branch`
- approval policy
- explicit Super Admin guard

They must be reviewed function-by-function; there will be no blanket revoke or blanket conversion to SECURITY INVOKER.

Remaining focused candidates after the sent-item wrapper:

- `resolve_product_modifiers(...)` current-user branch access
- stale demo helpers (`seed_demo_data`, `delete_demo_data`) if still canonical in Production

## P0-C

Supabase Auth Leaked Password Protection remains reported as disabled by Security Advisor. The currently connected Supabase management tools do not expose an Auth-config write operation for this setting. It must remain OPEN until it is actually enabled in Supabase Auth settings and a fresh Advisor run confirms closure.

## Safety decisions

- No blanket `REVOKE EXECUTE` on authenticated application RPCs.
- No blanket conversion to `SECURITY INVOKER`.
- No RLS or test weakening.
- No Production changes from an unverified branch.
- No force-push or branch-ref tricks for cleanup.
- Every promoted hardening batch must pass Fresh DB + Integration/Security/RLS + Browser Smoke before Production.

## Remaining P0

1. Anonymous SECURITY DEFINER exposure: CLOSED ✅
2. Permission/scope hardening batch #25: CLOSED ✅
3. `next_document_number` internal-only boundary: CLOSED ✅
4. `cancel_sent_order_item(...)` wrapper boundary: IN VERIFICATION ⏳
5. Remaining narrow authenticated helper candidates: OPEN
6. Leaked Password Protection: OPEN — requires Supabase Auth configuration
7. Final full Verify + runtime smoke + handover/Zero-Drift documentation after P0 closure.
