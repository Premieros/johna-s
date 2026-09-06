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

### cancel_sent_order_item wrapper boundary — PR #27

PR #27 hardened `public.cancel_sent_order_item(uuid, uuid, numeric, text)` so authentication and branch authorization occur before any sent-item lookup:

- migration `20260906115500_cancel_sent_order_item_wrapper_scope.sql`
- requires `auth.uid()` and an active application user
- resolves the order branch and requires `user_may_access_branch(...)` before `order_items` / `order_kitchen_sends` lookup
- preserves the public RPC signature and terminal `cancel_sent_order_item_exact(...)` behavior
- keeps `anon` denied and authenticated/service-role API access explicit
- regression test `tests/integration/cancel_sent_order_item_wrapper_security.test.ts`

PR #27 merged into `main` as `9f69a67c596609c71420b1190e77e702a5029f1e`. Verify main #781 / run `34026096066` passed frontend, Fresh DB/schema, Integration/Security/RLS and Browser Smoke. GitHub Pages deploy #558 passed on the same merge SHA. The exact tracked migration was then applied to Production `azzdesuowpdcoflmyezn`; catalog verification confirms `search_path=public, pg_temp`, `anon_exec=false`, authenticated/service-role EXECUTE retained, and the branch guard appears before the sent-item lookup. CLOSED ✅

## Final handover branch organization

- `main` is Production/Release only.
- The single permanent development line is `development/final-handover`.
- Short-lived fix branches may be used for isolated reviewed batches and must be removed after promotion.
- Historical fix/development branches are superseded and must not be reused.
- No force-update workaround is used for cleanup.

## resolve_product_modifiers branch boundary — IN VERIFICATION ⏳

Read-only Production inspection confirmed that `public.resolve_product_modifiers(uuid, uuid, jsonb)` is `SECURITY DEFINER` and externally executable by `authenticated`, but currently trusts the caller-supplied `p_branch_id` without first proving that the current user may access that branch. Product and modifier existence checks therefore occur before current-user branch authorization and can act as a cross-branch information oracle.

Call-graph inspection confirmed the resolver is also used by normal POS pricing/inventory paths including `process_sale`, order-item pricing triggers, and sale inventory deduction, so the public contract must be preserved and regression-tested rather than removed.

Hardening prepared on short-lived branch `fix/resolve-product-modifiers-scope`:

- migration `20260906130000_resolve_product_modifiers_scope.sql`
- require `auth.uid()` first
- require an active application user
- require `user_may_access_branch(p_branch_id)` before any product/modifier lookup
- preserve modifier validation, pricing, snapshot generation, and public RPC signature
- preserve authenticated/service-role grants and keep anon denied
- regression test `tests/integration/resolve_product_modifiers_security.test.ts`
- existing full modifier lifecycle integration test remains the operational regression gate

No Production DDL for this batch until frontend + Fresh DB/schema + Integration/Security/RLS + Browser Smoke gates are green and the change is merged to `main`.

## Authenticated SECURITY DEFINER classification

The remaining Advisor warnings are not treated as automatic vulnerabilities. Many are intentional application RPCs and already enforce one or more of:

- `auth.uid()`
- canonical permissions
- `user_may_access_branch`
- approval policy
- explicit Super Admin guard

They must be reviewed function-by-function; there will be no blanket revoke or blanket conversion to SECURITY INVOKER.

Remaining focused candidates after the modifier resolver:

- stale demo helpers (`seed_demo_data`, `delete_demo_data`) if still canonical in Production
- remaining costing/detail RPCs and admin/Super Admin grants identified by the function-by-function audit

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
4. `cancel_sent_order_item(...)` wrapper boundary: CLOSED ✅
5. `resolve_product_modifiers(...)` branch boundary: IN VERIFICATION ⏳
6. Remaining narrow authenticated helper candidates: OPEN
7. Leaked Password Protection: OPEN — requires Supabase Auth configuration
8. Final full Verify + runtime smoke + handover/Zero-Drift documentation after P0 closure.
