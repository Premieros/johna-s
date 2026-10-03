# CURRENT WORK PLAN — johna-s — SOURCE OF TRUTH

## Active work
- Track: **Branch Pulse Workflow Codes**
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Latest main baseline reconciled: `74c00c9898d8c03931ffe0429b2d43c9e7c07033`
- Active development branch: `development/branch-pulse-workflow-codes-20261003`
- Mandatory active work log: `docs/BRANCH_PULSE_WORKFLOW_CODES_2026-10-03.md`

## Operational rules
- السجل هو المرجع الإجباري للعمل، وهذا الملف يحدد المسار النشط الوحيد.
- CI يجب أن يفشل إذا كان السجل الإلزامي مفقودًا أو لا يطابق المسار النشط.
- Single writer on the active branch.
- No direct write to `main`; no force push.
- Unexpected branch HEAD or latest-main movement => **STOP_AND_RECONCILE**.
- لا Merge ولا Production migration قبل exact-head Full Verify Green + موافقة صريحة.
- Any additional Production apply requires separate explicit approval.
- No Dashboard changes.
- Preserve Permission-First, branch isolation and current operational truth.
- Printing, Print Agent, KDS, settlement, inventory deduction, accounting posting and shift mutation logic remain frozen.

## Current objective
Present Branch Pulse as neutral workflow activity for the selected period. Human-readable problem labels are removed from the panel; anomalies are shown only as opaque internal codes, and user-issue groups are shown as opaque event codes without raw messages or screen/action details.

## Verified state
- PR #439 merged to `main@4b55bb50c768a0650e99fbe7500bc95a0fda70c5`.
- Exact-head Verify #3694 was fully Green.
- Production migration `system_health_branch_pulse_20261003` is recorded as version `20261003160107`.
- Branch Pulse and user-issue summary both return success in a live read-only Super Admin check.
- No telemetry test rows were inserted.
- No Dashboard, Print Agent, KDS, settlement, inventory, accounting, or shift mutation path was changed.

## Remaining gated work
- Advisor follow-up: telemetry `user_id` FK has no covering index. This is a performance-only follow-up and is not applied without separate approval.
- ERP-05 Waste Center Production migration remains a separate pending Production gate and is not authorized by the Branch Pulse approval.
