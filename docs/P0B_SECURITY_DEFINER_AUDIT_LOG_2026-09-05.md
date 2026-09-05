# P0-B SECURITY DEFININER Audit Log — 2026-09-05

> Mandatory execution log for SECURITY DEFINER hardening.
> Repository: `Premieros/johna-s`.
> Locked Supabase project: `azzdesuowpdcoflmyezn` only (`john's`, eu-west-1).

## Base identity
- Base branch: `main`.
- Verified base SHA before work: `c33c0df17119c0d3fb365b1c9b960d3f5dd09026`.
- Source of Truth: `docs/CURRENT_WORK_PLAN.md`.
- P0-A Permission-First root closure is merged and post-merge Verify #726 + Deploy #524 passed.
- No Production DDL is permitted in this batch; Production access is read-only audit only.

## Production audit snapshot
Read-only audit on Supabase `azzdesuowpdcoflmyezn` found:
- Public SECURITY DEFINER functions: **215**.
- Executable by `anon`: **3**.
- Executable by `authenticated`: **163**.
- SECURITY DEFINER functions missing an explicit fixed `search_path`: **0**.

Current Security Advisor categories:
- `anon_security_definer_function_executable`.
- `authenticated_security_definer_function_executable`.
- `auth_leaked_password_protection` disabled (P0-C, not changed in this batch).

## Initial classification
### Anon-executable
1. `_production_schema_contract_kitchen_v1()` — intentionally called by production-parity deploy verification using the anon key. Do not blindly revoke; harden without breaking the release gate.
2. `get_login_email(text)` — pre-auth username/login helper; requires separate abuse/privacy review before altering its execute grant.
3. `record_login_failure(text)` — pre-auth lockout helper; requires abuse/DoS review before altering its execute grant.

### Confirmed high-risk authenticated RPCs
Production read-only inspection found:
- `get_super_admin_all_users()` is SECURITY DEFINER, executable by `authenticated`, and has no internal Super Admin guard while returning cross-user identity/profile data.
- `get_super_admin_tenant_stats()` is SECURITY DEFINER, executable by `authenticated`, and has no internal Super Admin guard while returning global tenant statistics.

These are the first P0-B hardening targets.

## Locked remediation rules
- Super Admin remains the only implicit bypass.
- Do not authorize by `owner`, `manager`, or other role labels.
- Do not weaken RLS or tests.
- Keep `search_path = public, pg_temp` on SECURITY DEFINER functions.
- Add explicit internal authorization to privileged RPCs and least-privilege EXECUTE grants.
- Test on Fresh DB + Integration/Security/RLS + Browser Smoke before merge.
- No Production DDL in this PR.

## Status
`IN_PROGRESS — initial audit complete; high-risk privileged RPC hardening next.`
