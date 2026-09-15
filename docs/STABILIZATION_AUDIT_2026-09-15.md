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

PR #128 (`development/status-registry-unification-v2`) is docs-only governance work based on the same baseline. Before any runtime write, re-check latest `main`; if it moves, refresh/rebase this audit before changing application code.

## Phase A — Freeze & Evidence

Status: **COMPLETE FOR APPLICATION-STRUCTURE BASELINE**.

The repository already has a feature-oriented primary implementation under `src/features/`:

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

Shared/application layers exist under `src/api`, `src/app`, `src/components`, `src/context`, `src/core`, `src/hooks`, and `src/lib`.

No structural file has been moved or deleted.

## Phase B — Module Boundary Audit

Classification values: `CLEAN`, `SHARED-BY-DESIGN`, `LEGACY-REFERENCED`, `COUPLING-DEFECT`, `NEEDS-MORE-EVIDENCE`.

### 1. Auth / Users / Permissions — `SHARED-BY-DESIGN`

Evidence:

- canonical UI authorization resolves via `useCan(permission)`;
- Super Admin is the only implicit bypass in the canonical permission checker;
- all other roles resolve permissions from the DB-backed permission map;
- route protection generally receives explicit permission names.

Risk requiring focused regression before any change:

- `src/app/routes.tsx` still contains role-aware navigation/landing behavior (`cashier` landing and `ownerOnly` / `isAdminRole` paths).
- These are not yet classified as an authorization defect because landing/navigation behavior is not automatically a security boundary.
- Before changing them, prove whether any protected capability can actually be reached without the required permission at UI + server/RLS boundaries.

Decision: **no runtime edit**.

### 2. Branch / Warehouse context — `SHARED-BY-DESIGN`

Evidence:

- active branch has a single shared storage/state primitive in `src/lib/activeBranch.ts`;
- the V2 gateway consumes that same primitive rather than maintaining an independent branch ID;
- `V2BranchProvider` validates the selected ID against accessible branches before changing it.

This means the V2 branch selector is a wrapper over the canonical active-branch state, not a separate branch model.

Warehouse isolation remains a backend/data-contract concern and will be regression-tested separately.

Decision: **no consolidation change**.

### 3. `src/v2` — `SHARED-BY-DESIGN` with compatibility surface to monitor

Earlier concern that `src/v2` might be a second operational implementation is **not supported by current evidence**.

Evidence:

- `src/v2/pages` currently contains the gateway page rather than a second POS/application page tree;
- the V2 capability registry explicitly maps each module to canonical production routes;
- it states that V2 is a permission-aware gateway and must not maintain a second POS, shift, inventory, procurement, or reporting flow;
- module cards are filtered by canonical permissions and link to canonical routes.

Therefore `src/v2` must **not** be deleted as generic legacy code during cleanup.

Remaining check: dormant compatibility files under `src/v2/core` / `src/v2/context` may be removable only if exact references + regression coverage prove them unused.

Decision: **preserve**.

### 4. Catalog / Raw Materials / Manufactured Items / Modifier Groups — `SHARED-BY-DESIGN` + `LEGACY-REFERENCED`

Evidence from routing and current simplification contracts:

- products/categories/modifiers are owned by catalog surfaces;
- raw materials and recipes remain in the manufacturing feature area;
- old `/components` is a redirect to products;
- old production/manufacturing route names redirect to supported recipe/catalog flows rather than exposing a second implementation.

This is a naming/legacy-route situation, not enough evidence for file deletion or domain relocation.

Decision: **do not move raw materials/recipes just to make folder names prettier**.

### 5. POS / Tables / Orders / Payments / Shifts — `CLEAN AT ROUTE/FEATURE BOUNDARY`, regression sweep pending

Evidence:

- POS pages are owned by `src/features/pos`;
- canonical POS route requires `pos.view`;
- shifts have their own permission and canonical route;
- mobile work changed presentation while desktop/canonical business handlers remained shared.

High-risk behavior to preserve in regression sweep:

- order/table ownership;
- partial item transfer to another/new table;
- operator reassignment permissions;
- hold/resume;
- normal + split payment;
- mobile vs desktop parity of business actions.

Decision: **no cleanup edit until regression proof**.

### 6. Kitchen / KDS — `SHARED-BY-DESIGN`, recently stabilized

Evidence:

- PR #125 established branch-scoped kitchen stations while preserving Print Agent contract;
- PR #126 fixed branch-scoped KDS station authorization compatibility;
- Full Verify #1373 and post-merge Verify main #1375 are Green.

Frozen contracts:

- `send_to_kitchen` remains stock-consumption authority;
- single first-send + positive delta only;
- retry cannot duplicate stock/KDS send;
- Print Agent/IPC/queues remain outside cleanup scope.

Decision: **treat as frozen unless a new regression is reproduced**.

### 7. Approvals — `CLEAN AT PERMISSION/ROUTE BOUNDARY`, workflow regression pending

The canonical route is permission-gated and the V2 registry points to the same approval workspace. No evidence of a parallel implementation was found in this pass.

Decision: **regression test before any cleanup**.

### 8. Reports / Finance — `CLEAN AT TOP-LEVEL FEATURE BOUNDARY`, internal coupling audit pending

Accounting and reporting have separate feature homes and canonical permissions/routes. No reason to merge these folders purely for structure.

Decision: inspect data/RPC dependencies later; no runtime edit now.

### 9. Printing / Print Agent — `FROZEN / SHARED-BY-DESIGN`

Recent kitchen/KDS work explicitly preserved Print Agent, IPC, queues and receipt/kitchen station-code contracts.

Decision: **excluded from generic cleanup**. Only a reproduced printing regression can open this scope.

### 10. Settings / Admin — `SHARED-BY-DESIGN`, permission regression pending

Admin owns branches/users/settings/approval administration surfaces; printer/station management remains permission-gated by settings/admin capabilities.

Decision: no relocation/refactor in stabilization pass.

## Current structural conclusion

**The project is already substantially modular. A broad module rewrite is NOT justified.**

The correct stabilization strategy is now:

1. preserve current feature folders;
2. prove regressions and cross-module coupling through tests/search before edits;
3. remove only confirmed dead compatibility code;
4. keep centralized routing unless a real defect is shown;
5. keep V2 gateway because current evidence shows it routes to canonical implementations rather than duplicating them.

## Next evidence sweep

Priority order:

1. Permission-First regression: classify all role-name checks as navigation-only vs authorization.
2. Global branch switch regression across representative modules.
3. Catalog/availability/recipe/modifier regressions.
4. POS ownership/transfer/reassignment/payment regressions.
5. Kitchen/KDS idempotency + station isolation (confirmation only, no redesign).
6. Approvals / shifts / reports.
7. Printing contract confirmation without modifying Print Agent.
8. Dead-code/reference audit only after the above.

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

No runtime cleanup change is justified yet. Continue regression/evidence collection. The first runtime diff, if any, must be a small fix for a proven defect with focused regression coverage.
