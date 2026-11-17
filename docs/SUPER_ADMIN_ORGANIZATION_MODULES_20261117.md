# Super Admin organization settings and modules — 2026-11-17

Mode SINGLE_WRITER, SEQUENTIAL_ONLY, STOP_AND_RECONCILE.
Branch: `feat/super-admin-organization-modules-20261117`
Baseline main: `7269ae2f24ac936710e7ed3783e315562990194a`.

## User requirement
Premier Super Admin must control **organizations**, each with independent settings and module access. Branches belong to organizations and keep independently scoped operational settings. A setting/feature of one organization must never alter another organization's entitlements.

## Verified existing architecture
- `organizations`: id/name/slug/status (two live organizations); `branches.organization_id` links branches.
- `features`: 30 canonical module/capability keys (pos/inventory/accounting/kds/reports/etc).
- `plans` and `subscriptions`: historic plan/tenant structure, existing `branch_feature_overrides`.
- **Critical**: the current production `resolve_feature_access(uuid,uuid,text,uuid)` returns unconditional `allowed:true,source:direct_access`. Thus ordinary plan/feature switches are presently not authoritative. Never promise a module is inaccessible based solely on a UI switch.
- `get_feature_access` checks branch access before delegating; `can_access_feature` delegates.
- Existing Super Admin organization list supports active/inactive only; previous PR #643 made branch settings independent.

## Delivery goals
1. Add explicit per-organization profile settings and per-organization module overrides, opt-in/no rows by default (current behavior unchanged).
2. A narrowly scoped Super Admin editor to select an organization, update profile, and set module rules only for that organization.
3. Server-side RLS, validated Super Admin write RPC, audit trail, and feature resolve deny when a module is explicitly disabled for that organization. Keep default allow when no org policy exists.
4. Every business operation/route not currently calling the feature resolver remains an enforcement gap: separately audit and wire its access before claiming complete module security.
5. Maintain precedence: platform admin > explicitly disabled organization module > ordinary currently allowed behavior. No organizational auto-enablement of modules for a different tenant. Keep branch settings independent.

No production writes or migrations without exact-head Verify, fresh DB, and explicit release preflight. Avoid enabling or disabling any existing org module automatically.

## Candidate implementation
- `20261117112000_organization_profile_module_controls.sql`: opt-in organization profile and feature override tables, tenant-scoped RLS read access, super-admin-only audited RPCs. The resolver keeps existing default direct allow for organizations without explicit override and denies explicitly disabled non-core modules for that exact organization.
- `OrganizationControlsPanel.tsx`: from organizations directory, manage selected organization's name, phone, address, logo, currency; display canonical module catalog and choose Default / Enabled / Disabled. Core system features cannot be disabled. Controlled selectors avoid stale organization data.
- New integration test covers non-admin denial, tenant A/B isolation, reset to default and independent organization profile. Unit contract covers no updates to branch settings or global plan features.
- **Remaining scope/security limitation:** existing application routes and privileged business RPCs do not universally enforce feature-access functions. The per-organization deny is authoritative **where the resolver is called**; full application route and API containment requires a separate audited module-to-route/operation implementation. Do not promise that all users are locked out by this UI before that integration.
- No organization was enabled/disabled or reassigned and no production migration was run.

## Enforced access integration — candidate
- The canonical permission→module map (`src/lib/permissionFeatureKey.ts`) is consumed by `useCan()` so protected routes and menu entries become unavailable to non-platform users when their organization explicitly disables a mapped module.
- The same mapping has a SQL counterpart `_permission_feature_key`. `can_permission`, the backend permission predicate used by many RLS policies and privileged POS/ERP RPCs, now denies a mapped permission when its organization module is explicitly off. No-override organization behavior remains unchanged.
- `get_my_disabled_organization_modules()` determines the caller's organization server-side, never trusting an arbitrary client-supplied tenant ID.
- Mapping includes POS, delivery, KDS, tables, inventory, counts, transfers, warehouses, recipes, manufacturing, waste, purchases, customers, suppliers, reports, accounting, shifts, audit, advanced permissions, branches, employees.
- Non-mapped catalog features (AI assistant, API access, units, import/export feature-level entitlements, costing and similar) are DISPLAYED but disabled in the editor with an enforcement-not-ready explanation. The server also rejects such writes as MODULE_ENFORCEMENT_NOT_READY. This prevents a misleading no-op switch.
- `tests/integration/organization_module_isolation.test.ts` exercises tenant A/B behavior, non-super-admin denial, disabled-module role permission denial, current-user feature list, reset and unsupported-module rejection.
- This is **not** a security proof that all business endpoints for all 30 modules are universally guarded. Some direct table insert/update RLS policies and security-definer entrypoints do not yet delegate to `can_permission`; these must be audited before claiming total module restriction.
- All current organizations have no new overrides. Core/system module disabling remains protected.
