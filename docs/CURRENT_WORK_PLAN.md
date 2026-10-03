# CURRENT WORK PLAN — johna-s — SOURCE OF TRUTH

## Active work
- Track: **System Health Branch Pulse + User Issues**
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Latest main baseline reconciled: `7873cea47fca31b371cddf0775fbd6e589e57838`
- Active development branch: `development/system-health-branch-pulse-20261003`
- Mandatory active work log: `docs/SYSTEM_HEALTH_BRANCH_PULSE_2026-10-03.md`

## Operational rules
- السجل هو المرجع الإجباري للعمل، وهذا الملف يحدد المسار النشط الوحيد.
- CI يجب أن يفشل إذا كان السجل الإلزامي مفقودًا أو لا يطابق المسار النشط.
- Single writer on the active branch.
- No direct write to `main`; no force push.
- Unexpected branch HEAD or latest-main movement => **STOP_AND_RECONCILE**.
- لا Merge ولا Production migration قبل exact-head Full Verify Green + موافقة صريحة.
- Any Production apply requires a separate explicit approval after merge.
- No Dashboard changes.
- Preserve Permission-First, branch isolation and current operational truth.
- Printing, Print Agent, KDS, settlement, inventory deduction, accounting posting and shift mutation logic remain frozen.

## Current objective
- Add a one-button **Branch Pulse / نبضة الفروع** view inside System Health.
- Support 30m / 1h / 3h / 6h / 12h / Today / 24h / Custom windows.
- Show per-branch orders, completed sales/value, print submissions/failures, purchases/value, expenses/value, open shifts/operators and cross-signal warnings.
- Treat zero activity as neutral unless another signal proves a problem.
- Add a separate safe user-issue telemetry channel and a **problems only** view.
- Keep System Health read-only; capture is bounded and controlled.

## Verified baseline
- Existing System Health already has a read-only operational RPC and `settings.manage` access.
- Production has no dedicated client-error table today.
- `audit_log` is business/operation audit data and will not be repurposed.
- Existing data sources are present for Branch Pulse.
- Cloud print `submitted` means accepted by the system/OS boundary, not confirmed physical paper output.
- Production inspection for this track has been read-only only.

## Definition of done
- One bounded domain RPC returns all permitted branch activity for a selected window.
- Branch Pulse does not query operational tables directly from the page.
- Cross-signal warnings identify meaningful anomalies without flagging a quiet branch by itself.
- Error capture stores only bounded structured diagnostics and cannot accept arbitrary payloads.
- Error aggregation exposes affected users, recurrence, latest time and safe screen/action context.
- Quick **problems only** filter is available.
- Exact-head Verify + DB + Browser Smoke are Green before merge.
- No Production apply occurs without separate approval.
