# Stabilization Audit — 2026-09-15

Repository: `Premieros/johna-s`

Audit branch: `development/stabilization-audit-20260915`

Baseline (frozen for this audit): `main@8784e7b7102e946377a8ccd72073e01fbf929ef5`

## Safety mode

This audit is **Preservation First**. It does not authorize refactor-first work.

- No direct writes to `main`.
- No Force Push.
- No Production DB changes.
- No RLS/test weakening.
- No business-data reset/reseed/rewrite.
- No Print Agent / IPC / queue redesign.
- No working business logic is changed unless a regression is first proven and covered by a focused test.
- Historical branches are not merge sources.

## Baseline verification

- PR #126 is merged into `main` at `8784e7b7102e946377a8ccd72073e01fbf929ef5`.
- PR #126 pre-merge Full Verify #1373 was Green.
- Post-merge Verify main #1375 completed successfully.
- Deploy #647 completed successfully.
- PR #126 did not apply a Production migration as part of merge.

## Parallel work guard

At audit start, PR #128 (`development/status-registry-unification-v2`) remains an open **docs-only** governance PR based on the same main baseline. This audit must not copy runtime code from it or merge around it. If #128 moves or merges, refresh `main` before any runtime change.

## Phase A — Freeze & Evidence

Status: **STARTED**.

### Application structure observed

The repository already has a primary feature-oriented structure under `src/features/`, including:

- `auth`
- `admin`
- `catalog`
- `inventory`
- `manufacturing`
- `operations`
- `parties`
- `pos`
- `trade`
- `reporting`
- `accounting`
- `costing`
- `dashboard`
- `import-export`

Shared/application layers also exist under `src/api`, `src/app`, `src/components`, `src/context`, `src/core`, `src/hooks`, and `src/lib`.

### Structural items requiring audit — no edits yet

1. **Parallel `src/v2` tree still exists.**
   - `src/v2/context`
   - `src/v2/core`
   - `src/v2/pages`
   - `src/app/routes.tsx` still imports `V2GatewayPage`.
   - This is not automatically wrong, but it means module separation cannot yet be declared fully clean until active usage and ownership are mapped.

2. **Routing is centrally composed in a large `src/app/routes.tsx`.**
   - Feature pages are mostly separated correctly, but route/authorization composition remains centralized.
   - Do not split it merely for style; first prove whether this creates real coupling/regression risk.

3. **Permission-First routing requires a focused audit.**
   - Current route code contains explicit role-aware landing/guard logic in addition to permission checks (for example cashier landing and admin-role helper paths).
   - Standing contract remains: Super Admin may be implicit bypass; non-Super-Admin authorization should be Permission-First.
   - No change is made at this stage because each role-aware use must first be classified as display/landing behavior vs actual authorization boundary and covered by regression tests before any edit.

4. **Manufacturing naming/ownership remains a boundary to verify.**
   - `src/features/manufacturing` remains present while product/catalog simplification redirects some old manufacturing routes.
   - This may be valid because raw materials/recipes still need a domain home; audit will classify supported modules vs legacy route names before deletion or relocation.

## Phase B — Module Boundary Audit checklist

Each domain will be classified as `CLEAN`, `SHARED-BY-DESIGN`, `LEGACY-REFERENCED`, or `COUPLING-DEFECT` before any fix:

1. Auth / Users / Permissions
2. Branch / Warehouse context
3. Catalog / Raw Materials / Manufactured Items / Modifier Groups
4. Inventory / Purchases / Transfers / Waste
5. POS / Tables / Orders / Payments / Shifts
6. Kitchen / KDS
7. Approvals
8. Reports / Finance
9. Printing / Print Agent
10. Settings

## Regression sweep required before cleanup changes

The audit must prove existing behavior for:

- global branch switching and branch-scoped data;
- product/raw/manufactured availability and recipes;
- modifier groups and legacy component redirects;
- mobile POS vs desktop POS;
- order/table ownership and reassignment/transfer permissions;
- `send_to_kitchen` first send, delta, retry idempotency, and inventory deduction;
- KDS branch/station isolation;
- hold/resume, payment and split payment;
- approvals;
- shifts/reports;
- print-once/reprint and Print Agent contracts without redesign.

## Full Verify gate

No cleanup package can be called stable until all are Green on the exact candidate HEAD:

- identity locks
- lint
- app + test typecheck
- unit tests
- build
- fresh DB migrations
- schema verification
- integration/security/RLS
- Browser Smoke
- changed-files scope review

## Production parity

Production migration parity is a **separate audit**. Merge does not mean Supabase Production is fully applied.

Every migration must be classified as `Applied`, `Pending`, or `Not-for-Production` against Production `azzdesuowpdcoflmyezn` before any Production change. No pending migration may be applied without Full Green, impact review, and explicit separate approval.

## Current decision

Do **not** refactor or delete anything yet. Continue evidence collection and module-boundary classification first. The first allowed runtime change will only address a proven coupling/regression with a focused test and a small isolated diff.
