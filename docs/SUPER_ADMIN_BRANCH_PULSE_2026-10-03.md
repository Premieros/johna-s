# SUPER ADMIN BRANCH PULSE — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/super-admin-branch-pulse-20261003`
Current PR: `#0`
Last updated: 2026-10-03

## Work status
State: **BLOCKED**

UI-only follow-up to place the existing Branch Pulse and user-issue panels directly inside the Super Admin System Diagnostics tab.

## Guardrails
- No Production database mutation.
- No Dashboard, POS, Print Agent, KDS, settlement, inventory, accounting, or shift logic changes.
- Do not weaken the existing `/system-health` permission boundary.
- Reuse the existing Branch Pulse component and RPCs.
- Super Admin view may request all permitted branches; normal System Health behavior stays unchanged.
- No Merge before exact-head Full Verify Green and explicit approval.

## Baseline
- Main baseline: `cc26654353b5ffaf6b704a21aba9a707a60d7445`.
- User confirmed `/#/system-health` is not practically reachable from their Super Admin session.
- Source inspection shows `/system-health` is guarded by `settings.manage`; Super Admin does not automatically bypass that permission check.
- Super Admin already has a visible `صحة وتشخيص النظام` tab.
- `BranchPulsePanel` and Production RPCs are already deployed.

## Root-cause ledger
1. The feature exists but is mounted on a route the current Super Admin session cannot practically reach.
2. Super Admin diagnostics is the discoverable and correct administrative surface.
3. Current BranchPulsePanel pins to the active branch through `useBranchFilter`; the Super Admin diagnostics view should request all permitted branches.

## Change ledger
- `BranchPulsePanel` now supports an explicit `allBranches` mode while preserving existing default branch pinning.
- Super Admin → System Diagnostics now renders `<BranchPulsePanel allBranches />` below the existing self-check card.
- Diagnostics layout width was opened so branch cards can use the available space.
- Added `tests/unit/superAdminBranchPulseContract.test.ts` to lock the integration and preserve the standalone `settings.manage` route boundary.

## Verification ledger
- Source route and permission inspection completed.
- Exact-head CI: pending on the final implementation head.

## Production gate
State: **BLOCKED**

No Production database apply is required or authorized.

## Next action
Allow BranchPulsePanel to opt into all-branches scope, mount it under Super Admin diagnostics, add regression coverage, and run exact-head Full Verify.

## Mandatory update protocol
- Reconcile latest `main` before merge.
- Unexpected divergence => **STOP_AND_RECONCILE**.
- Keep State **BLOCKED** while the PR is open.
