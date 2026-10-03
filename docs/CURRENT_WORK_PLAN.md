# CURRENT WORK PLAN — johna-s — SOURCE OF TRUTH

## Active work
- Track: **Cancelled Work Scope Guard**
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Latest main baseline reconciled: `9e979ab7e2d1be0d49aeb7752a7799cdaeea937f`
- Active development branch: `docs/cancelled-work-scope-guard-20261003`
- Mandatory active work log: `docs/CANCELLED_WORK_SCOPE_GUARD_2026-10-03.md`

## Operational rules
- السجل هو المرجع الإجباري للعمل، وهذا الملف يحدد المسار النشط الوحيد.
- CI يجب أن يفشل إذا كان السجل الإلزامي مفقودًا أو لا يطابق المسار النشط.
- Single writer on the active branch.
- No direct write to `main`; no force push.
- Unexpected branch HEAD or latest-main movement => **STOP_AND_RECONCILE**.
- لا Merge ولا Production migration قبل exact-head Full Verify Green + موافقة صريحة.
- Branch existence alone is never authorization to resume work.
- Any request the user marks as mistaken, cancelled, or not intended becomes inert immediately.
- Cancelled work may resume only after a new explicit user request that re-authorizes that exact scope.
- `development/management-treasury-sheet-20261003` is cancelled and must not be resumed.
- See `docs/CANCELLED_WORK_SCOPES.md` for permanent cancelled-scope tombstones.

## Current objective
Make cancellation state durable so mistaken instructions cannot be reintroduced into execution from stale branches, stale plans, or prior messages.

## Explicitly cancelled scope
- The previously discussed management/dashboard/reports/treasury restructuring request was confirmed by the user to be a mistaken message.
- The branch `development/management-treasury-sheet-20261003` contains no intended implementation and is not executable.
- No UI restructuring, treasury redesign, report redesign, or related Production work is authorized from that cancelled request.

## Definition of done
- Permanent cancelled-scope registry exists and records the cancelled branch/scope.
- Execution guardrails explicitly state that branch existence is not authorization.
- Execution guardrails explicitly state that mistaken/cancelled requests are inert until newly authorized.
- Unit contract prevents silent removal of these protections.
- No runtime, database, Production data, treasury, reporting, POS, KDS, or printing behavior changes.
- Exact-head Verify is Green before merge.
