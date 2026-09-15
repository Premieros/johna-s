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

### 5. POS / Tables / Orders / Payments / Shifts — `CLEAN AT ROUTE/FEATURE BOUNDARY`

Evidence now confirmed:

- canonical POS route requires `pos.view`;
- server-side order ownership hardening from merged PR #122 requires the complete explicit manager capability set for another operator's active order: `pos.view` + `pos.order.edit` + `pos.order.transfer` + `users.manage`;
- direct `/pos/:orderId` access is server-authorized before fetching operational order data;
- cross-branch access remains fail-closed;
- operator reassignment is RPC/audit-context gated rather than a free row update;
- existing transfer flow remains the canonical `perform_pos_order_action` flow for partial quantity, occupied/vacant/new-table targets and approval handling.

Existing integration coverage includes `tests/integration/pos_table_busy_owner_resume.test.ts`, proving owner vs explicitly authorized manager behavior and branch isolation.

Decision: **preserve current implementation; no rewrite**.

### 6. Kitchen / KDS — `SHARED-BY-DESIGN`, regression coverage confirmed

Evidence:

- PR #125 established branch-scoped kitchen stations while preserving Print Agent contract;
- `tests/integration/kitchen_station_branch_isolation.test.ts` proves same station code may exist independently in two branches, selected-branch station listing, cross-branch assignment rejection, direct DB trigger protection and explicit multi-branch user assignment;
- `tests/unit/kitchenStationRoutingContract.test.ts` locks cashier as receipt-only, validates required category/station configuration and preserves station-code based cloud kitchen routing;
- PR #126 fixed branch-scoped KDS station authorization compatibility;
- PR #99 added a true two-session `send_to_kitchen` concurrency regression proving a second concurrent send becomes a successful no-op after the first commit, with one inventory deduction and one KDS send only;
- Full Verify #1373 and post-merge Verify main #1375 are Green.

Frozen contracts:

- `send_to_kitchen` remains stock-consumption authority;
- single first-send + positive delta only;
- retry cannot duplicate stock/KDS send;
- Print Agent/IPC/queues remain outside cleanup scope.

Decision: **treat as frozen unless a new regression is reproduced**.

### 7. Approvals — `CLEAN AT PERMISSION/ROUTE BOUNDARY`

The canonical route is permission-gated and the integration suite contains explicit approval-policy / cashier-manager approval coverage (`approval_policies.test.ts`, `cashier_manager_approval_e2e.test.ts`, plus specialized approval tests such as payment-method change).

Decision: **preserve; only open on reproduced regression**.

### 8. Reports / Finance — `CLEAN AT TOP-LEVEL FEATURE BOUNDARY`

Accounting and reporting have separate feature homes and canonical permissions/routes. The integration/unit suites include branch-scoped finance/report contracts and shift Permission-First coverage (including `close_shift_permission_first.test.ts`).

Decision: inspect specific RPC/data dependencies only when a concrete regression appears; no structural merge/refactor.

### 9. Printing / Print Agent — `FROZEN / SHARED-BY-DESIGN`

Current tests include branch print contracts and Print Agent security/concurrency contracts. Recent Kitchen/KDS work explicitly preserved Print Agent, IPC, queues and receipt/kitchen station-code contracts.

Decision: **excluded from generic cleanup**. Only a reproduced printing regression can open this scope.

### 10. Settings / Admin — `SHARED-BY-DESIGN`

Admin owns branches/users/settings/approval administration surfaces; kitchen-station management is route-gated by `settings.manage` and server-side assignment RPCs also require settings permission + branch access.

Decision: no relocation/refactor in stabilization pass.

## Legacy / dead-code candidates — do not delete yet

A previous simplification audit identified the old manufacturing client fallback as high risk. Current `main` still contains that fallback in `src/api/domains/manufacturing.ts`: if `complete_production_order` fails or returns unsuccessful, client code can fall back to direct writes against `raw_material_inventory`, `raw_material_movements`, `production_waste`, `inventory` and `production_orders`.

Important current context:

- Production `complete_production_order(uuid,jsonb)` exists.
- Current application routing redirects old Production/Manufacturing operational routes to supported recipe flows; `ProductionOrdersPage.tsx` remains in the tree but is not currently imported by `src/app/routes.tsx`.
- Therefore this is currently classified **LEGACY-REFERENCED / HIGH-RISK IF REACTIVATED**, not an active regression proven through the supported route.

Decision: **do not delete or rewrite it in this audit yet**. First prove exact import/reference reachability. If confirmed unreachable, remove it later with dead-code regression coverage. If reachable, replace the client-side stock mutation fallback with the canonical RPC-only contract in a dedicated small PR.

## Current structural conclusion

**The project is already substantially modular. A broad module rewrite is NOT justified.**

The correct stabilization strategy is now:

1. preserve current feature folders;
2. prove regressions and cross-module coupling through tests/search before edits;
3. remove only confirmed dead compatibility code;
4. keep centralized routing unless a real defect is shown;
5. keep V2 gateway because current evidence shows it routes to canonical implementations rather than duplicating them.

## Regression sweep status

- Permission-First canonical checker: **confirmed**.
- Global active-branch primitive: **confirmed shared**.
- Catalog simplification contracts: **covered by existing tests**.
- POS ownership / manager override / reassignment: **confirmed by merged server hardening + integration coverage**.
- Kitchen/KDS station isolation + concurrent send idempotency: **confirmed**.
- Approvals: **existing integration coverage present**.
- Shift Permission-First: **existing integration coverage present**.
- Printing: **existing unit/integration contracts present; frozen**.
- Remaining work: exact dead-code/reference audit + Production parity closure + final Full Verify of any runtime change (if one becomes justified).

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

## Production parity — READ-ONLY audit started

Production Supabase audited: `azzdesuowpdcoflmyezn`.

### Confirmed applied / present

Production migration history now contains the recent Kitchen/KDS and POS ownership contracts under Production-applied timestamps/names, including:

- branch-scoped kitchen station series;
- POS order ownership / operator reassignment / manager capability contracts;
- KDS branch-station-scope compatibility.

Production also currently exposes:

- `complete_production_order(uuid,jsonb)`;
- `user_may_access_branch(uuid)`;
- `send_to_kitchen(uuid,uuid)`;
- `can_manage_other_pos_orders()`;
- `kds_order_in_user_station_scope(uuid)`.

### Confirmed parity gaps — DO NOT APPLY YET

Two simplification/stabilization contracts present in repository evidence are **not yet reflected in Production behavior**:

1. **Canonical multi-branch SELECT policy on `branches`**
   - Production `auth_select_branches` currently allows platform admin, `id = get_branch_id()`, or organization membership.
   - It does **not** currently include `user_may_access_branch(id)`.
   - Therefore the repository's multi-branch branch-listing fix is still pending on Production behavior.

2. **POS auto-production negative-raw hardening**
   - Production `produce_inventory_unit(uuid,numeric,uuid,uuid,text)` currently contains the insufficient-raw guard but no `AUTO_SALE_PRODUCTION` marker.
   - Therefore the repository contract that allows negative raw only for the POS auto-production path while keeping manual production strict is not yet reflected in Production.

These are **Pending Production parity items**, not permission to change Production.

No migration was applied by this audit. Production data and schema remain untouched.

## Next action

1. Finish exact reference/dead-code audit for dormant manufacturing/legacy surfaces.
2. Re-check latest `main` and PR #128 before any runtime write.
3. If no active runtime defect is proven, keep PR #129 documentation-only and do not manufacture cleanup changes.
4. Prepare a Production parity report classifying the two confirmed pending contracts and any additional discovered gaps.
5. Production application requires separate explicit approval after impact review and Green verification.
