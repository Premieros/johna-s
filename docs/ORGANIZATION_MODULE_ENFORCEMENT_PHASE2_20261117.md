# Organization module enforcement — phase 2 (2026-11-17)

Execution: SINGLE_WRITER / SEQUENTIAL_ONLY / STOP_AND_RECONCILE.
Branch: `security/organization-module-enforcement-phase2-20261117`
Base: `71acc1ae17ce56202493fa610be9c1dcb3afb9d8`.

## User request
Complete outstanding security wiring for organization module controls in the Super Admin panel. Every real module disable needs a server-side enforced gate and corresponding UI gate, not just a hidden button. Avoid changing existing organizations when there is no override.

## Confirmed preflight
- Production catalog: 30 keys. The existing implemented permission mapper covers 21 of them; unsupported feature keys: `advanced_reports`, `ai_assistant`, `api_access`, `multi_branch`, `costing`, `units`, `excel_export`, `excel_import`, `customer_display`.
- `reports.costing` protects the Costing Center route and server guards, currently mapped to `reports` rather than `costing`.
- `reports.financial` protects financial report route and privileges, currently mapped to `reports`, can be separated into `advanced_reports` while retaining basic `reports.view`.
- `ImportExportCenterPage` uses `settings.manage`, direct client-side ImportExecutor and ExportService, and not independent import/export permission gates; a fake UI-only feature toggle would not be an authoritative API guard. Keep these locked pending end-to-end review.
- `ai_assistant`, `api_access`, `multi_branch`, `customer_display` have no concrete standalone feature implementations in the repository; do not invent APIs or mark these secure.
- `units` is entangled with raw material/component services and lacks standalone server permission; do not equate with InventoryUnitsPage (component groups).
- No production org feature overrides exist (count zero). No changes to production data anticipated beyond an additive, default-preserving security migration.

## Work packages
1. Add independently guarded real modules `costing` and `advanced_reports` through TypeScript permission mapping and SQL `_permission_feature_key` mapping, plus server allowlist, with fixture tests for deny/reset/other-org behavior.
2. Inspect import/export pathways and consider separate authorization for actual file import/export operations. Do not claim full coverage if raw table APIs remain accessible.
3. Make Super Admin show specific unsupported reasons for remaining features rather than misleading generic labels.
4. Exact-head Full Verify before merge; only deploy migration after merge, with post-apply production query and GitHub Pages check.

## Implemented in this branch
- TypeScript permission-to-feature mapping now treats `reports.costing` as `costing` and `reports.financial` as `advanced_reports`, instead of the general `reports` module; all unrelated permissions remain unchanged.
- A default-preserving additive SQL migration updates the authoritative `_permission_feature_key` used by `can_permission`, and extends the Super Admin RPC allowlist for these two keys; core/system locks and existing audit remain intact.
- Integration tests prove the Super Admin can disable each key for organization A, while organization B and `reports.view` remain allowed, followed by reset.
- The organization editor now provides concrete bilingual explanations for the seven still-unenforced registry keys instead of a generic message. It does not expose fake switches for inapplicable/unprotected capabilities.
- Security contract tests verify mapping parity and that unsupported controls stay disabled.
- **Remaining boundaries:** `ai_assistant`, `api_access`, `customer_display` have no standalone application feature implementation; `multi_branch` and `units` share existing authorization with other modules; `excel_import` and `excel_export` are client-side pipelines without dedicated server operation boundaries. Claiming complete, bypass-proof access controls for these keys without new backend workflows would be misleading. They remain unavailable pending implementation. Existing disabled modules may have legacy direct-data API gaps; separate broad RLS/RPC inventory is still needed.
- No business data was changed. No production migration until an exact-head Full Verify passes.
