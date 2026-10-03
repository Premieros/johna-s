# BRANCH PULSE WORKFLOW CODES — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/branch-pulse-workflow-codes-20261003`
Current PR: `#0`
Last updated: 2026-10-03

## Work status
State: **BLOCKED**

UI-only refinement requested by the user: present Branch Pulse as workflow activity for the selected period, and expose anomalies only as opaque internal codes rather than user-facing problem descriptions.

## Guardrails
- No Production database mutation.
- No changes to POS, Print Agent, KDS, Dashboard, accounting, inventory, settlement, or shift mutation logic.
- Keep current backend RPC contracts unchanged.
- Keep selected-period workflow metrics unchanged.
- Do not display raw user-facing error messages, screen/action details, or human-readable problem labels in the panel.
- No Merge before exact-head Full Verify Green and explicit approval.

## Baseline
- Main baseline: `74c00c9898d8c03931ffe0429b2d43c9e7c07033`.
- Branch Pulse is already mounted in Super Admin diagnostics.
- Current UI labels branches as `warning` / `Needs review` and exposes readable warning descriptions.
- Current User issues section exposes error messages, error_code, screen, action and technical/expected classification.

## Change ledger
- Branch state is now presented as neutral workflow activity: `Active / Quiet`.
- Human-readable anomaly labels were replaced with opaque `BP-01..BP-04` follow-up codes.
- User issue rows are now rendered as deterministic opaque `UX-XXXXXXXX` event codes.
- Raw user message, screen/action, error kind, and readable error code are no longer rendered in the panel.
- The filter is now `Branches with codes` instead of `Problems only`.
- Added `tests/unit/branchPulseWorkflowCodesContract.test.ts` and updated the existing Branch Pulse contract wording.

## Verification ledger
- Production logic review completed read-only.
- Exact-head CI: pending on the final implementation head.

## Production gate
State: **BLOCKED**

No Production database apply is needed or authorized.

## Next action
Render selected-period workflow neutrally, replace warning descriptions with opaque follow-up codes, and render user issue groups as opaque event codes only.

## Mandatory update protocol
- Reconcile latest `main` before merge.
- Unexpected divergence => **STOP_AND_RECONCILE**.
- Keep State **BLOCKED** while the PR is open.
