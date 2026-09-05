# P0-B SECURITY DEFINER Audit Log — 2026-09-05

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
- `get_super_admin_all_users(text)` is SECURITY DEFINER, executable by `authenticated`, and had no internal Super Admin guard while returning cross-user identity/profile data.
- `get_super_admin_tenant_stats()` is SECURITY DEFINER, executable by `authenticated`, and had no internal Super Admin guard while returning global tenant statistics.

## Hardening batch 1 — privileged Super Admin RPCs
Branch: `fix/security-definer-hardening`.

Added migration:
- `supabase/migrations/20260905214500_p0b_privileged_security_definer_guards.sql`

Changes:
- Preserves the current RPC signatures/result shapes.
- Recreates both privileged RPCs as fail-closed `SECURITY DEFINER` functions.
- Requires `public.is_pos_admin()` before any privileged data is returned; after P0-A this means Super Admin only.
- Pins `search_path = public, pg_temp`.
- Revokes `PUBLIC` and `anon` EXECUTE.
- Grants EXECUTE only to `authenticated` and `service_role`; authenticated callers are still subject to the internal Super Admin guard.

Added regression test:
- `tests/integration/security_definer_super_admin_guard.test.ts`

The test asserts:
- ordinary authenticated user cannot enumerate cross-user data;
- ordinary authenticated user cannot read tenant-wide stats;
- Super Admin can call both RPCs;
- `anon` has no EXECUTE grant on either privileged RPC.

Commits in this batch:
- `d5a444948e1f7c3187d88d16b337a4d63b3c5c05` — migration.
- `16d1723f355df7756490f2e83786e8abf5f831fe` — integration regression test.
- `0b5a9efcbb63c5624cf630e520f13fbf3b64afec` — required branch fixture for the new integration principals.

## Verify #728
Run: `33985254811`.
- Database Identity Lock ✅
- API Contract / lint / typecheck / test typecheck / unit / build ✅
- Fresh DB canonical migrations ✅
- Schema verification ✅
- Existing integration/security/RLS tests: **463 passed** ✅
- New P0-B suite did not execute because its `beforeAll` inserted users without the now-required `users.branch_id`.
- Exact DB error: `null value in column "branch_id" of relation "users" violates not-null constraint`.
- This was a test-fixture defect, not a migration or authorization failure.
- Fixed by creating a rollback-only test branch and assigning both test principals to it in commit `0b5a9ef...`.
- Browser Smoke was skipped because the DB job failed before the new suite could execute.

## Verify #730 — batch 1 closure
Run: `33985474473`.
- Frontend/API/lint/typecheck/unit/build ✅
- Fresh DB + Schema ✅
- Integration / Security / RLS ✅
- Browser Smoke ✅
- Batch 1 fully green.

## Broader authenticated SECURITY DEFINER classification
Read-only Production classification:
- authenticated-executable SECURITY DEFINER: **163**.
- **143/163** have a direct or known delegated authorization/scope guard (`auth.uid`, Super Admin/platform admin, `can_permission`, `user_may_access_branch`, or organization access).
- **20/163** require manual classification; wrappers are not automatically treated as vulnerabilities.
- Examples classified as delegated wrappers include `cancel_sent_order_item(...)` and summary helpers that call hardened target functions.
- `next_document_number(text)` remains manual because its correct capability depends on document type; no guessed blanket permission has been added.

## Hardening batch 2 — branch-scoped read RPCs
Production read-only inspection confirmed two additional SECURITY DEFINER read surfaces:
- `get_cost_history(uuid,integer)` could read cost history by product UUID without permission or branch validation.
- `get_user_branch_access(uuid)` could expose another user's branch map by user UUID without caller authorization/scope validation.

Added migration:
- `supabase/migrations/20260905222000_p0b_branch_scoped_security_definer_reads.sql`

Changes:
- `get_cost_history` now requires authenticated `products.view`, resolves the product branch, and requires `user_may_access_branch(branch_id)`; it revokes `PUBLIC`/`anon` and caps the requested row limit.
- `get_user_branch_access` now allows self-inspection, or requires `users.branches.manage` for another user; delegated callers cannot inspect Super Admin and cannot inspect targets outside their branch scope; returned branches are filtered to caller scope.
- Super Admin remains the only implicit bypass.
- No Production DDL was applied.

Added regression test:
- `tests/integration/security_definer_branch_scope_reads.test.ts`

It covers:
- in-scope vs cross-branch product cost history;
- self branch-access inspection;
- delegated in-scope vs out-of-scope target inspection;
- Super Admin invisibility to delegated managers;
- Super Admin cross-branch access.

Commits:
- `089a32452fc5c9d6d03f03090dbbbe22d3cd8695` — batch 2 migration.
- `45d184cc2973d4315bdcca2eed657e138a0e2811` — batch 2 regression suite.

## Verify #732 — fixture-only failure
Run: `33985771050`.
- Frontend/API/lint/typecheck/unit/build ✅
- Fresh DB canonical migrations ✅
- Schema verification ✅
- Existing integration/security/RLS tests passed before the new suite setup failure.
- The new branch-scope suite stopped in `beforeAll` because schema triggers may already mirror `users.branch_id` into `user_branch_access`; the fixture then inserted the same `(user_id, branch_id)` pair again and hit the unique constraint.
- Root cause: non-idempotent test fixture, not authorization/migration logic.
- Fixed in commit `43d07e685fa3fc0f86616e5b5c3f0f97d9b49250` by using `ON CONFLICT (user_id, branch_id) DO NOTHING` for rollback-only fixture grants.
- Browser Smoke skipped because the DB job failed at fixture setup.

## Locked remediation rules
- Super Admin remains the only implicit bypass.
- Do not authorize by `owner`, `manager`, or other role labels.
- Do not weaken RLS or tests.
- Keep `search_path = public, pg_temp` on SECURITY DEFINER functions.
- Add explicit internal authorization to privileged RPCs and least-privilege EXECUTE grants.
- Test on Fresh DB + Integration/Security/RLS + Browser Smoke before merge.
- No Production DDL in this PR.

## Status
`IN_PROGRESS — batch 1 fully green; batch 2 fixture fixed; current-head full Verify pending; remaining manual candidates continue after batch 2 is proven green.`
