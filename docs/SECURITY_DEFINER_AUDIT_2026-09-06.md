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

## Final handover branch organization

- `main` is Production/Release only.
- The single active development line is `development/final-handover`.
- Historical fix/development branches are superseded and must not be reused.
- Stale PR #20 was closed during handover cleanup because its security work was superseded by later merged P0-B batches.
- The connector available in this workspace cannot delete Git branch refs; no force-update workaround will be used.

## next_document_number internal boundary — preflight

Read-only Production inspection confirmed `public.next_document_number(text)` is a shared internal helper used by privileged order, purchasing, stock, treasury and accounting RPCs. It mutates `document_sequences` and was directly executable by signed-in users solely because it lived as an exposed SECURITY DEFINER function.

Final-handover hardening:

- migration `20260905230000_next_document_number_internal_only.sql`
- `search_path = public, pg_temp`
- revoke `PUBLIC`, `anon`, and direct `authenticated` EXECUTE
- retain explicit `service_role` EXECUTE
- function owner remains able to call the helper from existing SECURITY DEFINER application RPCs
- regression test `tests/integration/next_document_number_security.test.ts`
  - proves anon/authenticated have no direct EXECUTE
  - proves service-role backend boundary remains functional

No Production DDL will be applied until the normal frontend + Fresh DB/schema + Integration/Security/RLS + Browser Smoke gates are green.

## Authenticated SECURITY DEFINER classification

The remaining Advisor warnings are not treated as automatic vulnerabilities. Many are intentional application RPCs and already enforce one or more of:

- `auth.uid()`
- canonical permissions
- `user_may_access_branch`
- approval policy
- explicit Super Admin guard

They must be reviewed function-by-function; there will be no blanket revoke or blanket conversion to SECURITY INVOKER.

Remaining focused candidates after the document-number helper:

- `cancel_sent_order_item(...)` wrapper pre-authorization lookup
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
3. `next_document_number` internal-only boundary: IN VERIFICATION ⏳
4. Remaining narrow authenticated helper candidates: OPEN
5. Leaked Password Protection: OPEN — requires Supabase Auth configuration
6. Final full Verify + runtime smoke + handover/Zero-Drift documentation after P0 closure.
