# P0-B SECURITY DEFINER Audit Log — 2026-09-05

> Mandatory execution log for SECURITY DEFINER hardening.
> Repository: `Premieros/johna-s`.
> Locked Supabase project: `azzdesuowpdcoflmyezn` only (`john's`, eu-west-1).

## Base identity
- Base branch: `main`.
- Current audited main base: `dca66a7ae3ff56097ad829a85ea928e04bc3a4f6`.
- Source of Truth: `docs/CURRENT_WORK_PLAN.md`.
- P0-A is merged; Verify #726 + Deploy #524 passed.
- Production remains read-only during this PR until the full CI gate passes.

## Production audit snapshot
- Public SECURITY DEFINER functions: **215**.
- Executable by `anon`: **3**.
- Executable by `authenticated`: **163**.
- SECURITY DEFINER functions missing an explicit fixed `search_path`: **0**.

### Anon-executable classification
1. `_production_schema_contract_kitchen_v1()` — release sentinel; it only inspects catalogs, so this batch converts it to `SECURITY INVOKER` while preserving anon parity access.
2. `get_login_email(text)` — intentional pre-auth username helper; remains under abuse/privacy review.
3. `record_login_failure(text)` — intentional pre-auth lockout helper; remains under abuse/DoS review.

## Confirmed high-risk exposure fixed in candidate
Production inspection proved these RPCs were SECURITY DEFINER + executable by authenticated with no internal Super Admin guard:
- `get_super_admin_all_users(text)`.
- `get_super_admin_tenant_stats()`.

Candidate migration `20260905214500_security_definer_handover_hardening.sql`:
- converts the schema sentinel to SECURITY INVOKER;
- adds `public.is_pos_admin()` fail-closed guards to both global Super Admin read RPCs;
- revokes anon/PUBLIC execute on the privileged RPCs;
- preserves authenticated/service-role access only because the UI RPC still needs an authenticated Super Admin session;
- changes future postgres/public function defaults so anon/authenticated/PUBLIC do not receive automatic EXECUTE;
- keeps explicit `search_path = public, pg_temp`.

Regression test added:
- `tests/integration/security_definer_handover.test.ts`.

## P0-C / branch protection constraints
- Supabase Advisor still reports leaked-password protection disabled. Current Supabase docs state this is available on Pro and above and is configured in Auth settings. The connected Supabase tool exposes database/advisor operations but not the Auth config PATCH action, so this cannot be truthfully marked enabled from this session.
- GitHub `main` is currently unprotected. The connected GitHub actions available here do not expose a branch-protection write operation; this must remain an explicit handover control until an admin-capable settings action is available.

## Gate
Before merge or Production DDL:
- Database Identity Lock ✅ required.
- Fresh DB + canonical migrations ✅ required.
- Integration/Security/RLS ✅ required.
- Browser Smoke ✅ required.

## Status
`IN_PROGRESS — high-risk RPC candidate patched; full CI required before merge/Production.`
