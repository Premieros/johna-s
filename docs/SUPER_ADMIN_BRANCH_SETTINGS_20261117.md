# Super Admin branch-specific settings — 2026-11-17

Execution: SINGLE_WRITER. Branch `fix/super-admin-branch-specific-settings-20261117`; base `39fefacc02337b1ac9b8d9a0025159601f5c558a`. STOP_AND_RECONCILE on unexpected HEAD. Sequential repository writes.

## User requirement
Super Admin console's **global settings editor** is the problem (not the Online pricing module). The General tab currently edits the shared `public.settings` row (store name, tax, currency, POS defaults, receipt) and a separate Branch Overrides tab edits `public.branch_settings`. User wants every branch independently configurable by Super Admin, no general operational edit or cross-branch changes.

## Scope
- Remove Super Admin global operational settings editor and its `save()` handler.
- Replace Branch Overrides with clear **Branch Settings** tab and required branch picker; preserve branch-scoped fields (currency, logo, receipt headers/footers, tax rate/status, stock threshold, business-day mode/times, shift auto-close).
- Save only selected `branch_id` through existing RLS-protected `saveBranchSettings()`.
- Distinguish and retain non-branch-wide platform controls (organizations, roles, audit, health) separately.
- No change to existing tax engine, inherited defaults, historical rows, operating data, online pricing or POS writers. Removing the shared editor does not remove legacy shared fallback settings used by existing code; full elimination of all legacy fallback semantics is out of scope and would need a wider migration.
- Test tab presence / absence of shared save, per-branch selector, permission behavior and switching reset, exact-head full CI before release.

## Gate
Draft PR only until CI green. No production migrations required for UI-only change. Pages deployment requires success on merged main after Full Verify.
