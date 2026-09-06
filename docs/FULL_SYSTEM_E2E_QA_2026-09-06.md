# Full-System E2E QA Acceptance Log — 2026-09-06

## Scope lock

- Started: 2026-09-06T18:11+03:00
- Repository: `Premieros/johna-s`
- Development branch: `development/final-handover`
- Production branch: `main`
- Supabase Production Project Ref: `azzdesuowpdcoflmyezn`
- Start/checkpoint HEAD: `96ee84180e0b38250d28f9354a9c78978a56052e`
- Database identity source: `docs/DATABASE_IDENTITY_LOCK.md`

## Acceptance methodology

This log records only executed evidence. A route/button is not marked PASS unless the relevant operation and its persisted effect are verified. Existing Playwright browser smoke uses mocked Supabase Auth/REST/RPC and is therefore counted as UI regression coverage only, not as real UI-to-database E2E evidence.

The acceptance sequence combines:

1. Production read-only / transaction-rolled-back security probes.
2. Real RPC/RLS execution under simulated authenticated/anonymous database roles.
3. Fresh-database canonical migration + integration/security tests.
4. Browser/UI regression coverage.
5. Production parity/deploy checks for fixes that are ultimately merged.

No Production DDL is applied before a fix is represented by a canonical migration and passes the relevant regression/CI gates.

## Stage 0 — Baseline / identity / CI

### Checkpoint

- `main` HEAD verified at `96ee84180e0b38250d28f9354a9c78978a56052e`.
- `development/final-handover` HEAD verified at the same SHA before QA writes.
- Production migrations were enumerated from `azzdesuowpdcoflmyezn`; latest applied migration is `order_cashier_assignment_and_recipe_delete_fix`.
- Previous release evidence at checkpoint: PR #32 merged; branch Verify #811 full PASS; GitHub Pages deploy #563 PASS; Production API parity PASS.
- `docs/CURRENT_WORK_PLAN.md`, `docs/MASTER_LOG2.md`, and `docs/DATABASE_IDENTITY_LOCK.md` were read before modifications.

### Known open external/platform item

- **QA-P0-C — Leaked Password Protection Disabled**
  - Expected: compromised-password protection enabled for production Auth.
  - Actual: Supabase Security Advisor reports `auth_leaked_password_protection` WARN.
  - Status: OPEN — platform configuration; not treated as code-complete.

## Stage 24 early attack probes — anonymous and branch boundary

### QA-SEC-001 — Anonymous table access probe

- Expected: anonymous role cannot read or insert operational business data.
- Tables probed: `user_branch_access`, `inventory_units`, `inventory_unit_entries`, `inventory_unit_batches`, `kitchen_stations`, `measurement_units`, `product_unit_links`, `waste_categories`.
- Actual: `has_table_privilege('anon', ...)` returned false for all checked SELECT privileges and false for `inventory_units` INSERT.
- Result: **PASS**.
- Note: advisor policy warnings alone were not counted as defects because the role has no base table privilege on these surfaces.

### QA-SEC-002 — `resolve_product_modifiers` cross-branch attack

- Expected: authenticated Branch A user calling resolver with Branch B product/branch IDs is denied before product/modifier details are exposed.
- Production function state verified: SECURITY DEFINER, `search_path = public, pg_temp`, anon EXECUTE false, authenticated/service_role EXECUTE true, active-user and branch guard before product checks.
- Attack: executed under `SET LOCAL ROLE authenticated` with a real active non-super-admin user from Branch A and a real active modifier-bearing product from Branch B; transaction rolled back.
- Actual: `{success:false,error:"BRANCH_MISMATCH"}`.
- Result: **PASS**.
- No code change required; the previously recorded audit concern had already been closed by migration `resolve_product_modifiers_scope`.

## Defect register

| ID | Severity | Area | Status | Evidence / next action |
| --- | --- | --- | --- | --- |
| QA-P0-C | Security WARN | Supabase Auth | OPEN | Enable Leaked Password Protection at platform level; advisor currently reports disabled. |

## Next execution checkpoint

Continue in the required dependency order with Fresh DB / real RPC + RLS acceptance: Super Admin → Branches → Warehouses → Users/Roles/Permissions → Categories/Units/Inventory → Products/Modifiers/Recipes → operational modules → Shift/POS/KDS/Payments → reports/integrity → destructive recreate tests → concurrency → full RLS attack matrix → Fresh DB/full CI.
