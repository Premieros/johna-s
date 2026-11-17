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
