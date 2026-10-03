# BRANCH PULSE WORKFLOW CODES — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/branch-pulse-workflow-codes-20261003`
Current PR: `#443`
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

## Root-cause ledger
1. The current panel mixes workflow monitoring with problem verdicts.
2. Human-readable anomaly labels can be misinterpreted by non-owner users who can view administrative screens.
3. User issue rows currently expose readable error details that the owner prefers to keep opaque.
4. Selected-period activity is the intended primary purpose; anomaly data should remain secondary and coded.

## Change ledger
- Branch state is now presented as neutral workflow activity: `Active / Quiet`.
- Human-readable anomaly labels were replaced with opaque `BP-01..BP-04` follow-up codes.
- User issue rows are now rendered as deterministic opaque `UX-XXXXXXXX` event codes.
- Raw user message, screen/action, error kind, and readable error code are no longer rendered in the panel.
- The filter is now `Branches with codes` instead of `Problems only`.
- Added `tests/unit/branchPulseWorkflowCodesContract.test.ts` and updated the existing Branch Pulse contract wording.

## Verification ledger
- Production logic review completed read-only.
- Verify #3706 / workflow `37142259981` failed at the mandatory worklog gate because `## Root-cause ledger` was missing. Runtime code/tests were not reached.
- Exact-head CI: pending after this worklog-only fix.

## Production gate
State: **BLOCKED**

No Production database apply is needed or authorized.

## Next action
Render selected-period workflow neutrally, replace warning descriptions with opaque follow-up codes, and render user issue groups as opaque event codes only.

## Mandatory update protocol
- Reconcile latest `main` before merge.
- Unexpected divergence => **STOP_AND_RECONCILE**.
- Keep State **BLOCKED** while the PR is open.
